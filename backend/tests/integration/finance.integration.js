import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { connectDatabase, database } from "../../src/services/database.js";
import {
  User,
  PlayerStatistics,
  ChipTransaction,
  Friendship,
  Block,
  Loan,
  ChipTransfer,
  LoanRepayment,
  Message,
} from "../../src/models/index.js";
import { friendshipAction } from "../../src/services/social.js";
import {
  transferChips,
  createLoan,
  respondLoan,
  repayLoan,
  listLoans,
  LOAN_DURATION_MS,
} from "../../src/services/finance.js";
import { testDatabaseUri } from "./test-database.js";
import {
  leaderboard,
  leaderboardPosition,
} from "../../src/services/leaderboard.js";
import { createApplication } from "../../src/app.js";
import { testConfig } from "../helpers.js";

test("transfers and loans preserve chips, enforce consent and overdue restrictions, and repay exactly once", async () => {
  const ids = [];
  let application;
  try {
    const uri = new URL(testDatabaseUri());
    uri.pathname = `/finance_test_${randomUUID().replaceAll("-", "")}`;
    await connectDatabase(uri.toString());
    for (let i = 0; i < 3; i++) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      ids.push(
        (
          await database.createUser({
            username: `Loan${suffix}`,
            email: `${suffix}@example.test`,
            passwordHash: "test",
          })
        )._id,
      );
    }
    const [a, b, c] = ids.map(String);
    await friendshipAction(a, b, "request");
    await friendshipAction(b, a, "accept");
    await friendshipAction(b, c, "request");
    await friendshipAction(c, b, "accept");
    const transferId = randomUUID();
    await Promise.all([
      transferChips(a, b, 20, transferId),
      transferChips(a, b, 20, transferId),
    ]);
    assert.equal(await ChipTransfer.countDocuments({ sender: a }), 1);
    assert.equal((await User.findById(a)).chips, 80);
    assert.equal((await User.findById(b)).chips, 120);
    await assert.rejects(
      transferChips(a, b, 21, transferId),
      /different terms/,
    );
    await assert.rejects(
      transferChips(a, c, 1, randomUUID()),
      /accepted friends/,
    );
    const now = new Date();
    const key = randomUUID();
    const offer = await createLoan(a, b, "lend", 40, key, now);
    assert.equal(
      String((await createLoan(a, b, "lend", 40, key, now))._id),
      String(offer._id),
    );
    await assert.rejects(
      respondLoan(a, offer._id, "accept", now),
      /cannot perform/,
    );
    await Promise.all([
      respondLoan(b, offer._id, "accept", now),
      respondLoan(b, offer._id, "accept", now),
    ]);
    assert.equal((await User.findById(a)).chips, 40);
    assert.equal((await User.findById(b)).chips, 160);
    const netRanks = await leaderboard(1, "net");
    assert.equal(
      netRanks.players.find((player) => player.id === b).netChips,
      120,
    );
    assert.equal((await leaderboardPosition(b, "net")).rank, 1);
    assert.equal(
      (await Loan.findById(offer._id)).deadline.getTime(),
      now.getTime() + LOAN_DURATION_MS,
    );
    const overdue = new Date(now.getTime() + LOAN_DURATION_MS + 1);
    await assert.rejects(
      transferChips(b, c, 1, randomUUID(), overdue),
      /overdue/,
    );
    await assert.rejects(
      createLoan(b, c, "borrow", 1, randomUUID(), overdue),
      /overdue/,
    );
    assert.equal((await listLoans(b, overdue))[0].status, "overdue");
    await friendshipAction(a, b, "block");
    await repayLoan(b, offer._id, 15, randomUUID(), overdue);
    assert.equal((await Loan.findById(offer._id)).outstanding, 25);
    const repaymentId = randomUUID();
    await Promise.all([
      repayLoan(b, offer._id, 25, repaymentId, overdue),
      repayLoan(b, offer._id, 25, repaymentId, overdue),
    ]);
    const loan = await Loan.findById(offer._id);
    assert.equal(loan.status, "repaid");
    assert.equal(loan.outstanding, 0);
    assert.equal(loan.repayments.length, 2);
    assert.equal(await LoanRepayment.countDocuments({ borrower: b }), 2);
    await transferChips(b, c, 1, randomUUID(), overdue);
    assert.equal((await User.findById(a)).chips, 80);
    assert.equal((await User.findById(b)).chips, 119);
    assert.equal((await User.findById(c)).chips, 101);
    await Message.deleteMany({});
    assert.equal((await listLoans(b, overdue))[0].status, "repaid");
    const cancelled = await createLoan(
      b,
      c,
      "borrow",
      5,
      randomUUID(),
      overdue,
    );
    await respondLoan(b, cancelled._id, "cancel", overdue);
    assert.equal((await Loan.findById(cancelled._id)).status, "cancelled");
    const declined = await createLoan(b, c, "borrow", 5, randomUUID(), overdue);
    await respondLoan(c, declined._id, "decline", overdue);
    assert.equal((await Loan.findById(declined._id)).status, "declined");
    await assert.rejects(
      createLoan(b, c, "borrow", 501, randomUUID(), overdue),
      /whole number/,
    );
    application = createApplication({
      config: testConfig,
      repository: database,
    });
    const browsers = [
      request.agent(application.app),
      request.agent(application.app),
    ];
    const apiIds = [];
    for (const browser of browsers) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const registration = await browser
        .post("/api/auth/register")
        .send({
          username: `Api${suffix}`,
          email: `api${suffix}@example.test`,
          password: "test-password-long",
        })
        .expect(201);
      apiIds.push(registration.body.user.id);
      ids.push(registration.body.user.id);
    }
    await browsers[0]
      .post(`/api/social/friends/${apiIds[1]}/request`)
      .expect(200);
    await browsers[1]
      .post(`/api/social/friends/${apiIds[0]}/accept`)
      .expect(200);
    const created = await browsers[0]
      .post("/api/social/loans")
      .send({
        otherId: apiIds[1],
        direction: "borrow",
        amount: 5,
        requestId: randomUUID(),
      })
      .expect(201);
    await browsers[0]
      .post(`/api/social/loans/${created.body.id}/accept`)
      .expect(403);
    await browsers[1]
      .post(`/api/social/loans/${created.body.id}/accept`)
      .expect(200);
    await browsers[0]
      .post(`/api/social/loans/${created.body.id}/repay`)
      .send({ amount: 5, requestId: randomUUID() })
      .expect(200);
    assert.equal(
      (await browsers[0].get("/api/social/loans").expect(200)).body.loans[0]
        .status,
      "repaid",
    );
  } finally {
    application?.io.close();
    if (ids.length) {
      for (const model of [PlayerStatistics, ChipTransaction])
        await model.deleteMany({ user: { $in: ids } });
      await Friendship.deleteMany({
        $or: [{ first: { $in: ids } }, { second: { $in: ids } }],
      });
      await Block.deleteMany({
        $or: [{ blocker: { $in: ids } }, { blocked: { $in: ids } }],
      });
      await Loan.deleteMany({
        $or: [{ borrower: { $in: ids } }, { lender: { $in: ids } }],
      });
      await ChipTransfer.deleteMany({ sender: { $in: ids } });
      await LoanRepayment.deleteMany({ borrower: { $in: ids } });
      await User.deleteMany({ _id: { $in: ids } });
    }
    await mongoose.disconnect();
  }
});
