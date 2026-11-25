import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { ChipTransaction, User } from "../models/index.js";

export const STARTING_CHIPS = 100;
export const DAILY_CHIPS = 10;
export const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000;

// All balance mutations and ledger entries must share the caller's transaction.
export async function creditWallet({ userId, amount, key, kind, session }) {
  if (!session || !Number.isSafeInteger(amount) || amount <= 0 || !key || !kind)
    throw new Error("Invalid wallet credit.");
  const prior = await ChipTransaction.findOne({ key }).session(session).lean();
  if (prior) {
    if (
      String(prior.user) !== String(userId) ||
      prior.amount !== amount ||
      prior.kind !== kind
    )
      throw new Error("Wallet transaction key reused with different terms.");
    return prior;
  }
  const user = await User.findOneAndUpdate(
    { _id: userId, chips: { $lte: Number.MAX_SAFE_INTEGER - amount } },
    { $inc: { chips: amount } },
    { session, returnDocument: "after" },
  );
  if (!user) throw new Error("Wallet unavailable or balance limit exceeded.");
  const [entry] = await ChipTransaction.create(
    [
      {
        user: userId,
        key,
        kind,
        amount,
        balanceAfter: user.chips,
      },
    ],
    { session },
  );
  return entry;
}

export async function debitWallet({ userId, amount, key, kind, session }) {
  if (!session || !Number.isSafeInteger(amount) || amount <= 0 || !key || !kind)
    throw new Error("Invalid wallet debit.");
  const prior = await ChipTransaction.findOne({ key }).session(session).lean();
  if (prior) {
    if (
      String(prior.user) !== String(userId) ||
      prior.amount !== -amount ||
      prior.kind !== kind
    )
      throw new Error("Wallet transaction key reused with different terms.");
    return prior;
  }
  const user = await User.findOneAndUpdate(
    { _id: userId, chips: { $gte: amount } },
    { $inc: { chips: -amount } },
    { session, returnDocument: "after" },
  );
  if (!user) {
    const error = new Error("Insufficient chips for this transaction.");
    error.status = 409;
    throw error;
  }
  const [entry] = await ChipTransaction.create(
    [{ user: userId, key, kind, amount: -amount, balanceAfter: user.chips }],
    { session },
  );
  return entry;
}

export async function initializeWallet(userId, session) {
  // Match the stored field, not Mongoose defaults, so existing accounts migrate once.
  const result = await User.updateOne(
    { _id: userId, chips: { $exists: false } },
    { $set: { chips: 0 } },
    { session },
  );
  if (result.modifiedCount) {
    await creditWallet({
      userId,
      amount: STARTING_CHIPS,
      key: `opening:${userId}`,
      kind: "opening",
      session,
    });
  }
}

export async function accessWallet(userId, now = new Date()) {
  return mongoose.connection.transaction(async (session) => {
    await initializeWallet(userId, session);
    const eligibleBefore = new Date(now.getTime() - DAILY_INTERVAL_MS);
    const eligible = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { lastDailyRewardAt: null },
          { lastDailyRewardAt: { $lte: eligibleBefore } },
        ],
      },
      { $set: { lastDailyRewardAt: now } },
      { session, returnDocument: "after" },
    );
    if (eligible) {
      await creditWallet({
        userId,
        amount: DAILY_CHIPS,
        key: `daily:${randomUUID()}`,
        kind: "daily",
        session,
      });
    }
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("Wallet owner not found.");
    return {
      user,
      rewardGranted: Boolean(eligible),
      nextRewardAt: new Date(
        user.lastDailyRewardAt.getTime() + DAILY_INTERVAL_MS,
      ),
    };
  });
}
