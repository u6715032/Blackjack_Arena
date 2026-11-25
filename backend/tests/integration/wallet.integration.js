import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { connectDatabase, database } from "../../src/services/database.js";
import { createApplication } from "../../src/app.js";
import { testConfig } from "../helpers.js";
import {
  User,
  ChipTransaction,
  PlayerStatistics,
} from "../../src/models/index.js";
import { accessWallet, DAILY_INTERVAL_MS } from "../../src/services/wallet.js";
import { testDatabaseUri } from "./test-database.js";

test("wallet: opening balances, legacy migration and concurrent rolling rewards", async () => {
  const ids = [];
  let application;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  try {
    await connectDatabase(testDatabaseUri());
    const user = await database.createUser({
      username: `Wallet${suffix}`,
      email: `${suffix}@example.test`,
      passwordHash: "test",
    });
    ids.push(user._id);
    assert.equal(user.chips, 100);
    assert.equal(
      await ChipTransaction.countDocuments({
        user: user._id,
        kind: "opening",
        amount: 100,
      }),
      1,
    );
    const legacyId = new mongoose.Types.ObjectId();
    ids.push(legacyId);
    await User.collection.insertOne({
      _id: legacyId,
      username: `Legacy${suffix}`,
      email: `legacy${suffix}@example.test`,
      passwordHash: "test",
      tokenVersion: 0,
    });
    await PlayerStatistics.create({ user: legacyId, totalGames: 7, wins: 4 });
    const now = new Date("2026-01-01T00:00:00.000Z");
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => accessWallet(legacyId, now)),
    );
    assert.equal(claims.filter((claim) => claim.rewardGranted).length, 1);
    assert.equal((await User.findById(legacyId)).chips, 110);
    assert.equal(
      (await PlayerStatistics.findOne({ user: legacyId })).totalGames,
      7,
    );
    assert.equal(
      await ChipTransaction.countDocuments({ user: legacyId, kind: "opening" }),
      1,
    );
    assert.equal(
      await ChipTransaction.countDocuments({ user: legacyId, kind: "daily" }),
      1,
    );
    assert.equal(
      (
        await accessWallet(
          legacyId,
          new Date(now.getTime() + DAILY_INTERVAL_MS - 1),
        )
      ).rewardGranted,
      false,
    );
    assert.equal(
      (
        await accessWallet(
          legacyId,
          new Date(now.getTime() + DAILY_INTERVAL_MS),
        )
      ).rewardGranted,
      true,
    );
    assert.equal((await User.findById(legacyId)).chips, 120);
    assert.equal(
      await ChipTransaction.countDocuments({ user: legacyId, kind: "daily" }),
      2,
    );
    application = createApplication({
      config: testConfig,
      repository: database,
    });
    const browser = request.agent(application.app);
    const registered = await browser
      .post("/api/auth/register")
      .send({
        username: `Api${suffix}`,
        email: `api${suffix}@example.test`,
        password: "test-password-long",
      })
      .expect(201);
    ids.push(registered.body.user.id);
    assert.equal(registered.body.user.chips, 100);
    const sessions = await Promise.all(
      Array.from({ length: 4 }, () => browser.get("/api/auth/me").expect(200)),
    );
    assert.equal(
      sessions.filter((result) => result.body.rewardGranted).length,
      1,
    );
    assert.ok(sessions.every((result) => result.body.user.chips === 110));
    const login = await browser
      .post("/api/auth/login")
      .send({
        email: `api${suffix}@example.test`,
        password: "test-password-long",
      })
      .expect(200);
    assert.equal(login.body.rewardGranted, false);
    assert.equal(login.body.user.chips, 110);
  } finally {
    application?.io.close();
    if (ids.length) {
      await ChipTransaction.deleteMany({ user: { $in: ids } });
      await PlayerStatistics.deleteMany({ user: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
});
