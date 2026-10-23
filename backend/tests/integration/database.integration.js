// Explicit opt-in integration test: real Atlas, real FastAPI, disposable test users.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { readConfig } from "../../src/config.js";
import { connectDatabase, database } from "../../src/services/database.js";
import { User, GameHistory, PlayerStatistics } from "../../src/models/index.js";
import { createApplication } from "../../src/app.js";
import { createRound, processStand } from "../../src/game/engine.js";
import { testShoe } from "../helpers.js";

test("real Atlas: accounts, real AI bots/advice, durable history, statistics and idempotency", async () => {
  const config = readConfig();
  const createdIds = [];
  let application;
  try {
    await connectDatabase(config.mongoUri);
    application = createApplication({
      config,
      repository: database,
      shoeFactory: () =>
        testShoe(
          "5",
          "6",
          "7",
          "10",
          "6",
          "7",
          "8",
          "7",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "10",
        ),
    });
    const first = request.agent(application.app);
    const second = request.agent(application.app);
    const suffix = randomUUID().slice(0, 12).replaceAll("-", "");
    for (const [index, agent] of [first, second].entries()) {
      const result = await agent
        .post("/api/auth/register")
        .send({
          username: `Verify${suffix}${index}`,
          email: `verify-${suffix}-${index}@example.test`,
          password: "integration-only-password",
        })
        .expect(201);
      createdIds.push(result.body.user.id);
      const user = await User.findById(result.body.user.id).select(
        "+passwordHash",
      );
      assert.notEqual(user.passwordHash, "integration-only-password");
      assert.match(user.passwordHash, /^\$2/);
    }
    await first
      .post("/api/auth/login")
      .send({
        email: `verify-${suffix}-0@example.test`,
        password: "incorrect-password",
      })
      .expect(401);
    let game = (
      await first.post("/api/games/single").send({ botCount: 2 }).expect(201)
    ).body.game;
    const advice = await first
      .post("/api/games/single/advice")
      .send({ roundId: game.id, revision: game.revision })
      .expect(200);
    assert.ok(["HIT", "STAND"].includes(advice.body.action));
    game = (
      await first
        .post("/api/games/single/action")
        .send({ action: "STAND", roundId: game.id, revision: game.revision })
        .expect(200)
    ).body.game;
    assert.equal(game.status, "complete");
    assert.equal(game.saved, true);
    assert.equal(game.aiError, null);
    assert.equal((await first.get("/api/history")).body.history.length, 1);
    assert.equal(
      (await second.get(`/api/history?user=${createdIds[0]}`)).body.history
        .length,
      0,
    );
    assert.equal(
      (await first.get("/api/statistics")).body.statistics.totalGames,
      1,
    );
    // A separate deterministic round verifies repeated and concurrent save requests.
    const round = createRound(
      [{ id: createdIds[0], username: "Verification" }],
      "single",
      testShoe("10", "10", "8", "7"),
    );
    processStand(round, createdIds[0]);
    await database.saveRound(round);
    await database.saveRound(round);
    await Promise.all([database.saveRound(round), database.saveRound(round)]);
    assert.equal(
      await GameHistory.countDocuments({
        user: createdIds[0],
        roundId: round.id,
      }),
      1,
    );
    const stats = await PlayerStatistics.findOne({ user: createdIds[0] });
    assert.equal(stats.totalGames, 2);
    assert.equal(stats.wins + stats.losses + stats.pushes, 2);
    const anonymous = request(application.app);
    await anonymous.get("/api/profile").expect(401);
    await first.post("/api/auth/logout").expect(200);
    await first.get("/api/profile").expect(401);
    await first
      .post("/api/auth/login")
      .send({
        email: `verify-${suffix}-0@example.test`,
        password: "integration-only-password",
      })
      .expect(200);
  } finally {
    application?.io.close();
    // Remove ONLY the exact temporary users created by this test and their records.
    if (createdIds.length) {
      await GameHistory.deleteMany({ user: { $in: createdIds } });
      await PlayerStatistics.deleteMany({ user: { $in: createdIds } });
      await User.deleteMany({ _id: { $in: createdIds } });
    }
    await mongoose.disconnect();
  }
});
