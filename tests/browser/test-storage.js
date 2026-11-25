import mongoose from "mongoose";
import { testDatabaseUri } from "../../backend/tests/integration/test-database.js";
import {
  User,
  GameHistory,
  PlayerStatistics,
  RoundReceipt,
  Bet,
  ChipTransaction,
  WheelSpin,
  Friendship,
  Block,
  Message,
  Loan,
  ChipTransfer,
  LoanRepayment,
} from "../../backend/src/models/index.js";

export function requireBrowserTestDatabase() {
  const uri = testDatabaseUri();
  if (process.env.MONGODB_URI !== uri)
    throw new Error(
      "Browser tests require MONGODB_URI and MONGODB_TEST_URI to identify the same dedicated test database.",
    );
  return uri;
}
export async function cleanupBrowserUsers(ids) {
  if (!ids.length) return;
  await mongoose.connect(requireBrowserTestDatabase(), {
    serverSelectionTimeoutMS: 8000,
  });
  for (const model of [
    GameHistory,
    RoundReceipt,
    PlayerStatistics,
    Bet,
    ChipTransaction,
    WheelSpin,
  ])
    await model.deleteMany({ user: { $in: ids } });
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
  await ChipTransfer.deleteMany({
    $or: [{ sender: { $in: ids } }, { recipient: { $in: ids } }],
  });
  await LoanRepayment.deleteMany({ borrower: { $in: ids } });
  await User.deleteMany({ _id: { $in: ids } });
  await mongoose.disconnect();
}
