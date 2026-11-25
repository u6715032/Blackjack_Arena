import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import {
  User,
  PlayerStatistics,
  ChipTransaction,
  Bet,
  RoundReceipt,
  GameHistory,
  Friendship,
  Block,
  Message,
  Maintenance,
  Loan,
  LoanRepayment,
  ChipTransfer,
} from "../../src/models/index.js";
import { testDatabaseUri } from "./test-database.js";

test("restart refunds an unfinished wager, resumes chat cleanup and preserves loan obligations", async () => {
  const uri = new URL(testDatabaseUri());
  uri.pathname = `/restart_test_${randomUUID().replaceAll("-", "")}`;
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  let server, userId, otherId;
  async function start() {
    server = spawn(
      process.execPath,
      [new URL("../../src/server.js", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          MONGODB_URI: uri.toString(),
          JWT_SECRET: "restart-test-secret-at-least-32-characters",
          CLIENT_ORIGIN: "http://localhost:5173",
          AI_SERVICE_URL: "http://127.0.0.1:28000",
          COOKIE_SECURE: "false",
          PORT: String(port),
        },
        stdio: "ignore",
      },
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null)
        throw new Error("Test server exited before becoming ready.");
      try {
        if ((await fetch(`${base}/api/health`)).ok) return;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Test server did not become ready.");
  }
  async function stop(signal) {
    if (!server || server.exitCode !== null || server.signalCode !== null)
      return;
    const exit = once(server, "exit");
    server.kill(signal);
    await exit;
  }
  try {
    await start();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const registration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: `Restart${suffix}`,
        email: `${suffix}@example.test`,
        password: "restart-test-password",
      }),
    });
    assert.equal(registration.status, 201);
    userId = (await registration.json()).user.id;
    const cookie = registration.headers.get("set-cookie").split(";")[0];
    const headers = { "content-type": "application/json", cookie };
    const secondRegistration = await fetch(`${base}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: `Peer${suffix}`,
        email: `peer${suffix}@example.test`,
        password: "restart-test-password",
      }),
    });
    assert.equal(secondRegistration.status, 201);
    otherId = (await secondRegistration.json()).user.id;
    const otherHeaders = {
      "content-type": "application/json",
      cookie: secondRegistration.headers.get("set-cookie").split(";")[0],
    };
    async function post(path, requestHeaders, body = {}) {
      const response = await fetch(`${base}/api${path}`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(body),
      });
      assert.ok(response.ok, `${path} returned ${response.status}`);
      return response.json();
    }
    await post(`/social/friends/${otherId}/request`, headers);
    await post(`/social/friends/${userId}/accept`, otherHeaders);
    await post(`/social/messages/${otherId}`, headers, {
      text: "Clear this during scheduled cleanup.",
    });
    const loan = await post("/social/loans", headers, {
      otherId,
      direction: "borrow",
      amount: 10,
      requestId: randomUUID(),
    });
    await post(`/social/loans/${loan.id}/accept`, otherHeaders);
    let game;
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch(`${base}/api/games/single`, {
        method: "POST",
        headers,
        body: JSON.stringify({ botCount: 0, wager: 10 }),
      });
      assert.equal(response.status, 201);
      game = (await response.json()).game;
      if (game.status === "playing") break;
    }
    assert.equal(game.status, "playing");
    const before = (
      await (await fetch(`${base}/api/wallet`, { headers })).json()
    ).chips;
    await stop("SIGKILL");
    await mongoose.connect(uri.toString());
    await Maintenance.updateOne(
      { key: "chat" },
      { $set: { nextChatCleanupAt: new Date(0) } },
    );
    await mongoose.disconnect();
    await start();
    const after = (
      await (await fetch(`${base}/api/wallet`, { headers })).json()
    ).chips;
    assert.equal(after, before + 10);
    const messages = await (
      await fetch(`${base}/api/social/messages/${otherId}`, { headers })
    ).json();
    assert.equal(messages.messages.length, 0);
    const loans = await (
      await fetch(`${base}/api/social/loans`, { headers })
    ).json();
    assert.equal(loans.loans[0].outstanding, 10);
    assert.equal(loans.loans[0].status, "accepted");
    await stop("SIGTERM");
    await start();
    assert.equal(
      (await (await fetch(`${base}/api/wallet`, { headers })).json()).chips,
      after,
    );
    await post(`/social/loans/${loan.id}/repay`, headers, {
      amount: 10,
      requestId: randomUUID(),
    });
    await mongoose.connect(uri.toString());
    assert.equal((await Bet.findOne({ roundId: game.id })).status, "refunded");
    assert.equal(
      await ChipTransaction.countDocuments({ user: userId, kind: "refund" }),
      1,
    );
  } finally {
    await stop("SIGTERM");
    if (userId) {
      if (mongoose.connection.readyState !== 1)
        await mongoose.connect(uri.toString());
      for (const model of [
        PlayerStatistics,
        ChipTransaction,
        Bet,
        RoundReceipt,
        GameHistory,
      ])
        await model.deleteMany({
          user: { $in: [userId, otherId].filter(Boolean) },
        });
      const ids = [userId, otherId].filter(Boolean);
      await Friendship.deleteMany({
        $or: [{ first: { $in: ids } }, { second: { $in: ids } }],
      });
      await Block.deleteMany({
        $or: [{ blocker: { $in: ids } }, { blocked: { $in: ids } }],
      });
      await Message.deleteMany({
        $or: [{ sender: { $in: ids } }, { recipient: { $in: ids } }],
      });
      await Loan.deleteMany({
        $or: [{ borrower: { $in: ids } }, { lender: { $in: ids } }],
      });
      await LoanRepayment.deleteMany({ borrower: { $in: ids } });
      await ChipTransfer.deleteMany({ sender: { $in: ids } });
      await Maintenance.deleteOne({ key: "chat" });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
});
