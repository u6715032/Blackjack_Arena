import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import { User, WheelSpin } from "../models/index.js";
import { creditWallet, debitWallet, initializeWallet } from "./wallet.js";

export const WHEEL_COST = 2;
export const WHEEL_COOLDOWN_MS = 5000;
// Weights total 1,000: each weight is one tenth of one percent.
export const WHEEL_PRIZES = Object.freeze([
  { chips: 0, weight: 500 },
  { chips: 1, weight: 200 },
  { chips: 2, weight: 150 },
  { chips: 5, weight: 100 },
  { chips: 10, weight: 49 },
  { chips: 100, weight: 1 },
]);
export function wheelConfiguration() {
  const total = WHEEL_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  const expected =
    WHEEL_PRIZES.reduce((sum, prize) => sum + prize.chips * prize.weight, 0) /
    total;
  return {
    cost: WHEEL_COST,
    cooldownMs: WHEEL_COOLDOWN_MS,
    prizes: WHEEL_PRIZES.map((prize) => ({
      chips: prize.chips,
      probability: prize.weight / total,
    })),
    expectedPayout: expected,
    theoreticalRtp: (expected / WHEEL_COST) * 100,
  };
}
export function selectPrize(draw) {
  const total = WHEEL_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  if (!Number.isSafeInteger(draw) || draw < 0 || draw >= total)
    throw new Error("Invalid wheel draw.");
  let remaining = draw;
  return WHEEL_PRIZES.findIndex((prize) => {
    remaining -= prize.weight;
    return remaining < 0;
  });
}

export async function spinWheel(userId, requestId, now = new Date()) {
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      requestId,
    )
  ) {
    const error = new Error("Provide a valid unique spin request ID.");
    error.status = 400;
    throw error;
  }
  const total = WHEEL_PRIZES.reduce((sum, prize) => sum + prize.weight, 0);
  const prizeIndex = selectPrize(randomInt(total));
  const prize = WHEEL_PRIZES[prizeIndex].chips;
  return mongoose.connection.transaction(async (session) => {
    const existing = await WheelSpin.findOne({ user: userId, requestId })
      .session(session)
      .lean();
    if (existing) return existing;
    await initializeWallet(userId, session);
    const eligible = await User.findOneAndUpdate(
      {
        _id: userId,
        $or: [
          { lastWheelSpinAt: null },
          {
            lastWheelSpinAt: {
              $lte: new Date(now.getTime() - WHEEL_COOLDOWN_MS),
            },
          },
        ],
      },
      { $set: { lastWheelSpinAt: now } },
      { session, returnDocument: "after" },
    );
    if (!eligible) {
      const error = new Error("A spin is already in progress. Please wait.");
      error.status = 409;
      throw error;
    }
    await debitWallet({
      userId,
      amount: WHEEL_COST,
      key: `wheel-cost:${userId}:${requestId}`,
      kind: "wheel-cost",
      session,
    });
    if (prize)
      await creditWallet({
        userId,
        amount: prize,
        key: `wheel-prize:${userId}:${requestId}`,
        kind: "wheel-prize",
        session,
      });
    const [spin] = await WheelSpin.create(
      [{ user: userId, requestId, prize, prizeIndex, cost: WHEEL_COST }],
      { session },
    );
    return spin.toObject();
  });
}
