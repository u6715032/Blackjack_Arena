import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { connectDatabase, database } from "../../src/services/database.js";
import {
  User,
  Bet,
  ChipTransaction,
  PlayerStatistics,
  GameHistory,
  RoundReceipt,
} from "../../src/models/index.js";
import {
  placeBets,
  refundPendingBets,
  payout,
} from "../../src/services/betting.js";
import { createRound, processStand } from "../../src/game/engine.js";
import { testShoe } from "../helpers.js";
import { testDatabaseUri } from "./test-database.js";
import { selectPayoutRule } from "../../src/services/payouts.js";
import { createGameService } from "../../src/services/games.js";

test("durable wagers settle once, roll back together, and refund on recovery", async () => {
  const ids = [];
  try {
    const isolatedUri = new URL(testDatabaseUri());
    isolatedUri.pathname = `/betting_test_${randomUUID().replaceAll("-", "")}`;
    await connectDatabase(isolatedUri.toString());
    for (let i = 0; i < 2; i++) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const user = await database.createUser({
        username: `Bet${suffix}`,
        email: `${suffix}@example.test`,
        passwordHash: "test",
      });
      ids.push(user._id);
    }
    const [first, second] = ids.map(String);
    assert.equal(payout(10, "win", false), 20);
    assert.equal(payout(5, "win", true), 12);
    assert.equal(payout(7, "push", false), 7);
    assert.equal(payout(7, "loss", false), 0);
    assert.equal(
      selectPayoutRule("experimental", { totalGames: 10, wins: 3 }),
      "experimental-boost-v1",
    );
    assert.equal(
      selectPayoutRule("experimental", { totalGames: 10, wins: 4 }),
      "standard-v1",
    );
    assert.equal(
      selectPayoutRule("standard", { totalGames: 10, wins: 3 }),
      "standard-v1",
    );
    assert.equal(payout(10, "win", false, "experimental-boost-v1"), 21);
    for (const invalid of [0, -1, 1.2, Number.MAX_SAFE_INTEGER])
      assert.throws(() => payout(invalid, "win", false));
    const round = createRound(
      [{ id: first, username: "First", wager: 10 }],
      "single",
      testShoe("10", "10", "8", "7"),
    );
    await placeBets(round);
    assert.equal((await User.findById(first)).chips, 90);
    processStand(round, first);
    await Promise.all([database.saveRound(round), database.saveRound(round)]);
    assert.equal((await User.findById(first)).chips, 110);
    assert.equal((await Bet.findOne({ roundId: round.id })).status, "settled");
    const stats = await database.getStatistics(first);
    assert.equal(stats.chipsWagered, 10);
    assert.equal(stats.chipsReturned, 20);
    assert.equal(stats.get("actualRtp"), 200);
    assert.equal(
      await ChipTransaction.countDocuments({ user: first, kind: "settlement" }),
      1,
    );
    const unaffordable = createRound(
      [
        { id: first, username: "First", wager: 10 },
        { id: second, username: "Second", wager: 101 },
      ],
      "multi",
      testShoe("10", "10", "10", "10", "8", "7"),
    );
    await assert.rejects(placeBets(unaffordable), /Insufficient/);
    assert.equal((await User.findById(first)).chips, 110);
    assert.equal(await Bet.countDocuments({ roundId: unaffordable.id }), 0);
    const pending = createRound(
      [
        { id: first, username: "First", wager: 20 },
        { id: second, username: "Second", wager: 30 },
      ],
      "multi",
      testShoe("10", "10", "10", "10", "8", "7"),
    );
    await placeBets(pending);
    assert.equal((await User.findById(first)).chips, 90);
    await refundPendingBets();
    await refundPendingBets();
    assert.equal((await User.findById(first)).chips, 110);
    assert.equal((await User.findById(second)).chips, 100);
    assert.equal(
      await Bet.countDocuments({ roundId: pending.id, status: "refunded" }),
      2,
    );
    assert.equal(
      await ChipTransaction.countDocuments({
        user: { $in: ids },
        kind: "refund",
      }),
      2,
    );
    assert.equal((await database.getStatistics(first)).chipsWagered, 10);
    const service = createGameService({ repository: database, predict: async () => ({ action: "STAND" }), shoeFactory: () => testShoe("10", "10", "10", "10", "8", "7", "2", "3") });
    const firstUser = await User.findById(first);
    const secondUser = await User.findById(second);
    const lobby = service.createRoom(firstUser);
    service.joinRoom(secondUser, lobby.code);
    service.setRoomWager(first, 3);
    service.setRoomWager(second, 7);
    let room = await service.startRoom(first);
    assert.deepEqual(room.game.players.map((player) => player.wager), [3, 7]);
    while (room.game.status === "playing") room = await service.roomAction(room.game.currentPlayerId, { action: "STAND", roundId: room.game.id, revision: room.game.revision });
    assert.equal(room.game.saved, true);
    assert.equal(await Bet.countDocuments({ roundId: room.game.id, status: "settled" }), 2);
  } finally {
    if (ids.length) {
      for (const model of [
        Bet,
        ChipTransaction,
        PlayerStatistics,
        GameHistory,
        RoundReceipt,
      ])
        await model.deleteMany({ user: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
});
