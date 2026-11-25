import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { connectDatabase, database } from "../../src/services/database.js";
import {
  User,
  ChipTransaction,
  WheelSpin,
  PlayerStatistics,
} from "../../src/models/index.js";
import {
  selectPrize,
  wheelConfiguration,
  spinWheel,
} from "../../src/services/wheel.js";
import {
  leaderboard,
  leaderboardPosition,
} from "../../src/services/leaderboard.js";
import { testDatabaseUri } from "./test-database.js";
import { createApplication } from "../../src/app.js";
import { testConfig } from "../helpers.js";

test("wheel distribution, retries, concurrent requests, ledger and leaderboard", async () => {
  const ids = [];
  let application;
  try {
    const uri = new URL(testDatabaseUri());
    uri.pathname = `/wheel_test_${randomUUID().replaceAll("-", "")}`;
    await connectDatabase(uri.toString());
    const config = wheelConfiguration();
    assert.equal(config.cost, 2);
    assert.equal(config.expectedPayout, 1.59);
    assert.equal(config.theoreticalRtp, 79.5);
    const counts = config.prizes.map(() => 0);
    for (let index = 0; index < 1000; index++) counts[selectPrize(index)]++;
    assert.deepEqual(counts, [500, 200, 150, 100, 49, 1]);
    for (let i = 0; i < 2; i++) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const user = await database.createUser({
        username: `Wheel${suffix}`,
        email: `${suffix}@example.test`,
        passwordHash: "test",
      });
      ids.push(user._id);
    }
    const [first, second] = ids;
    const now = new Date();
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => spinWheel(first, key, now)),
    );
    assert.ok(
      results.every((spin) => spin.prizeIndex === results[0].prizeIndex),
    );
    assert.equal(await WheelSpin.countDocuments({ user: first }), 1);
    assert.equal(
      await ChipTransaction.countDocuments({ user: first, kind: "wheel-cost" }),
      1,
    );
    assert.equal((await User.findById(first)).chips, 98 + results[0].prize);
    await assert.rejects(
      spinWheel(first, randomUUID(), now),
      /already in progress/,
    );
    const competing = await Promise.allSettled([
      spinWheel(second, randomUUID(), now),
      spinWheel(second, randomUUID(), now),
    ]);
    assert.equal(competing.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(await WheelSpin.countDocuments({ user: second }), 1);
    const ranks = await leaderboard();
    assert.equal(ranks.players.length, 2);
    assert.ok(ranks.players[0].chips >= ranks.players[1].chips);
    assert.deepEqual(Object.keys(ranks.players[0]).sort(), [
      "chips",
      "id",
      "netChips",
      "rank",
      "username",
    ]);
    const position = await leaderboardPosition(first);
    assert.equal(
      position.rank,
      ranks.players.find((player) => player.id === String(first)).rank,
    );
    application = createApplication({
      config: testConfig,
      repository: database,
    });
    const browser = request.agent(application.app);
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const registration = await browser
      .post("/api/auth/register")
      .send({
        username: `Api${suffix}`,
        email: `api${suffix}@example.test`,
        password: "test-password-long",
      })
      .expect(201);
    ids.push(registration.body.user.id);
    await request(application.app).get("/api/wheel").expect(401);
    const settings = await browser.get("/api/wheel").expect(200);
    assert.equal(settings.body.theoreticalRtp, 79.5);
    const requestId = randomUUID();
    const firstSpin = await browser
      .post("/api/wheel/spin")
      .send({ requestId })
      .expect(200);
    const retry = await browser
      .post("/api/wheel/spin")
      .send({ requestId })
      .expect(200);
    assert.deepEqual(retry.body, firstSpin.body);
    const publicRanks = await request(application.app)
      .get("/api/leaderboard")
      .expect(200);
    assert.equal(publicRanks.body.players.length, 3);
    assert.ok(publicRanks.body.players.every((player) => !("email" in player)));
    await browser.get("/api/leaderboard/me").expect(200);
  } finally {
    application?.io.close();
    if (ids.length) {
      for (const model of [ChipTransaction, WheelSpin, PlayerStatistics])
        await model.deleteMany({ user: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
});
