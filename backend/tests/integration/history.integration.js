import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { readConfig } from "../../src/config.js";
import {
  connectDatabase,
  database,
  cleanupHistory,
} from "../../src/services/database.js";
import {
  User,
  GameHistory,
  PlayerStatistics,
  RoundReceipt,
} from "../../src/models/index.js";
import { createRound, processStand } from "../../src/game/engine.js";
import { testShoe } from "../helpers.js";

function completedRound(ids, playedAt = new Date()) {
  const game = createRound(
    ids.map((id) => ({ id: String(id), username: "RetentionTest" })),
    ids.length === 1 ? "single" : "multi",
    ids.length === 1
      ? testShoe("10", "10", "8", "7")
      : testShoe("10", "10", "10", "10", "8", "7"),
  );
  while (game.status === "playing")
    processStand(game, game.players[game.currentPlayerIndex].id);
  game.completedAt = playedAt;
  return game;
}

test("MongoDB retention, lifetime statistics, durable idempotency and legacy cleanup", async (t) => {
  const ids = [];
  try {
    await connectDatabase(readConfig().mongoUri);
    for (let index = 0; index < 3; index += 1) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const user = await database.createUser({
        username: `Retain${suffix}`,
        email: `${suffix}@example.test`,
        passwordHash: "test-only-hash",
      });
      ids.push(user._id);
    }
    const [first, second, legacy] = ids;
    const rounds = [];
    await t.test(
      "round 21 removes only the oldest; latest 20 are newest first",
      async () => {
        for (let index = 0; index < 21; index += 1) {
          const round = completedRound(
            [first],
            new Date(1700000000000 + index * 1000),
          );
          rounds.push(round);
          await database.saveRound(round);
          assert.equal(
            await GameHistory.countDocuments({ user: first }),
            Math.min(index + 1, 20),
          );
        }
        const history = await database.getHistory(first);
        assert.deepEqual(
          history.map((row) => row.roundId),
          rounds
            .slice(1)
            .reverse()
            .map((round) => round.id),
        );
        assert.equal(await GameHistory.countDocuments({ user: second }), 0);
        const stats = await database.getStatistics(first);
        assert.equal(stats.totalGames, 21);
        assert.equal(stats.wins, 21);
        assert.equal(stats.winPercentage, 100);
      },
    );
    await t.test(
      "concurrent duplicates including a pruned round never double-count",
      async () => {
        await Promise.all([
          database.saveRound(rounds[0]),
          database.saveRound(rounds[20]),
          database.saveRound(rounds[20]),
        ]);
        assert.equal((await database.getStatistics(first)).totalGames, 21);
        assert.equal(await GameHistory.countDocuments({ user: first }), 20);
        assert.equal(
          await GameHistory.countDocuments({
            user: first,
            roundId: rounds[0].id,
          }),
          0,
        );
      },
    );
    await t.test(
      "multiplayer retention and concurrent saves are independent per user",
      async () => {
        const multi = completedRound([first, second]);
        await Promise.all([
          database.saveRound(multi),
          database.saveRound(multi),
        ]);
        const more = Array.from({ length: 5 }, () => completedRound([first]));
        await Promise.all(more.map((round) => database.saveRound(round)));
        assert.equal(await GameHistory.countDocuments({ user: first }), 20);
        assert.equal(await GameHistory.countDocuments({ user: second }), 1);
        assert.equal((await database.getHistory(second))[0].roundId, multi.id);
        assert.equal((await database.getStatistics(first)).totalGames, 27);
        assert.equal((await database.getStatistics(second)).totalGames, 1);
        assert.equal((await database.getStatistics(second)).wins, 1);
      },
    );
    await t.test(
      "pruning failure rolls back history, receipt and lifetime statistics",
      async () => {
        const game = completedRound([first, second]);
        const mock = t.mock.method(GameHistory, "deleteMany", async () => {
          throw new Error("simulated prune failure");
        });
        await assert.rejects(
          database.saveRound(game),
          /simulated prune failure/,
        );
        mock.mock.restore();
        assert.equal(
          await RoundReceipt.countDocuments({ roundId: game.id }),
          0,
        );
        assert.equal(await GameHistory.countDocuments({ roundId: game.id }), 0);
        assert.equal((await database.getStatistics(first)).totalGames, 27);
        assert.equal((await database.getStatistics(second)).totalGames, 1);
        await database.saveRound(game);
        assert.equal((await database.getStatistics(first)).totalGames, 28);
        assert.equal((await database.getStatistics(second)).totalGames, 2);
      },
    );
    await t.test(
      "legacy cleanup uses bounded batches, orders ties by _id, preserves statistics and retry keys",
      async () => {
        const date = new Date("2025-01-01T00:00:00Z");
        const records = await GameHistory.insertMany(
          Array.from({ length: 225 }, (_, index) => ({
            user: legacy,
            roundId: randomUUID(),
            mode: index % 2 ? "multi" : "single",
            result: ["win", "loss", "push"][index % 3],
            playerTotal: 18,
            dealerTotal: 17,
            playedAt: index === 0 ? new Date(date.getTime() + 1000) : date,
          })),
        );
        await PlayerStatistics.updateOne(
          { user: legacy },
          {
            $set: {
              totalGames: 225,
              wins: 75,
              losses: 75,
              pushes: 75,
              winPercentage: 33.33,
            },
          },
        );
        const beforeStats = (await database.getStatistics(legacy)).toObject();
        const expected = await database.getHistory(legacy);
        await cleanupHistory({ userIds: [legacy] });
        assert.equal(await GameHistory.countDocuments({ user: legacy }), 20);
        assert.deepEqual(
          (await database.getHistory(legacy)).map((row) => String(row._id)),
          expected.map((row) => String(row._id)),
        );
        // First inserted row wins on playedAt, while equal timestamps use descending _id.
        assert.equal(String(expected[0]._id), String(records[0]._id));
        assert.equal(String(expected[1]._id), String(records.at(-1)._id));
        assert.equal(await RoundReceipt.countDocuments({ user: legacy }), 205);
        const retry = completedRound([legacy]);
        retry.id = records[1].roundId;
        await database.saveRound(retry);
        retry.id = records[0].roundId;
        await database.saveRound(retry);
        await cleanupHistory({ userIds: [legacy] });
        const afterStats = (await database.getStatistics(legacy)).toObject();
        for (const field of [
          "totalGames",
          "wins",
          "losses",
          "pushes",
          "winPercentage",
        ])
          assert.equal(afterStats[field], beforeStats[field]);
        assert.equal(await GameHistory.countDocuments({ user: legacy }), 20);
        assert.equal(await GameHistory.countDocuments({ user: first }), 20);
        assert.equal(await GameHistory.countDocuments({ user: second }), 2);
      },
    );
  } finally {
    if (ids.length) {
      await GameHistory.deleteMany({ user: { $in: ids } });
      await RoundReceipt.deleteMany({ user: { $in: ids } });
      await PlayerStatistics.deleteMany({ user: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
});
