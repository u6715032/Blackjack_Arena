import mongoose from "mongoose";
import {
  User,
  GameHistory,
  PlayerStatistics,
  RoundReceipt,
  ChipTransaction,
  Bet,
  WheelSpin,
  Friendship,
  Block,
  Message,
  Maintenance,
  Loan,
  ChipTransfer,
  LoanRepayment,
} from "../models/index.js";
import { calculateHandTotal } from "../game/engine.js";
import { initializeWallet, accessWallet } from "./wallet.js";
import { placeBets, settleBet } from "./betting.js";

mongoose.set("bufferCommands", false);

export async function connectDatabase(mongoUri) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  // Indexes make duplicate email and duplicate round protection effective before serving traffic.
  await User.init();
  await GameHistory.init();
  await PlayerStatistics.init();
  await RoundReceipt.init();
  await ChipTransaction.init();
  await Bet.init();
  await WheelSpin.init();
  await Friendship.init();
  await Block.init();
  await Message.init();
  await Maintenance.init();
  await Loan.init();
  await ChipTransfer.init();
  await LoanRepayment.init();
  await cleanupHistory();
}

const historyLimit = 20;
const cleanupBatchSize = 200;

function lockUserHistory(user, session) {
  // A shared write serializes saves and cleanup for this user across server processes.
  // MongoDB retries transactions that conflict on this document.
  return PlayerStatistics.findOneAndUpdate(
    { user },
    { $inc: { __v: 1 } },
    { session, upsert: true, returnDocument: "after" },
  );
}

async function pruneHistoryBatch(user, session) {
  const oldest = await GameHistory.find({ user })
    .sort({ playedAt: -1, _id: -1 })
    .skip(historyLimit)
    .limit(cleanupBatchSize)
    .select("_id roundId")
    .session(session)
    .lean();
  if (!oldest.length) return 0;
  // Seed receipts for legacy rows before deleting them, in the same transaction.
  await RoundReceipt.bulkWrite(
    oldest.map(({ roundId }) => ({
      updateOne: {
        filter: { user, roundId },
        update: { $setOnInsert: { user, roundId } },
        upsert: true,
      },
    })),
    { session },
  );
  await GameHistory.deleteMany(
    { user, _id: { $in: oldest.map(({ _id }) => _id) } },
    { session },
  );
  return oldest.length;
}

export async function cleanupHistory({ userIds } = {}) {
  // Stream affected users and commit bounded batches. Startup can safely resume after failure.
  const cursor = GameHistory.aggregate([
    ...(userIds
      ? [
          {
            $match: {
              user: {
                $in: userIds.map((id) => new mongoose.Types.ObjectId(id)),
              },
            },
          },
        ]
      : []),
    { $group: { _id: "$user", count: { $sum: 1 } } },
    { $match: { count: { $gt: historyLimit } } },
  ]).cursor();
  for await (const { _id: user } of cursor) {
    let removed;
    do {
      removed = await mongoose.connection.transaction(async (session) => {
        await lockUserHistory(user, session);
        return pruneHistoryBatch(user, session);
      });
    } while (removed === cleanupBatchSize);
  }
}

export const database = {
  isReady: () => mongoose.connection.readyState === 1,
  async createUser(values) {
    return mongoose.connection.transaction(async (session) => {
      const [user] = await User.create([values], { session });
      await PlayerStatistics.create([{ user: user._id }], { session });
      await initializeWallet(user._id, session);
      return User.findById(user._id).session(session);
    });
  },
  findUserByEmail: (email) => User.findOne({ email }).select("+passwordHash"),
  accessWallet,
  placeBets,
  findUserById: (id) =>
    mongoose.isValidObjectId(id) ? User.findById(id) : null,
  revokeSessions: (id) =>
    User.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } }),
  async getStatistics(user) {
    const statistics = await PlayerStatistics.findOne({ user }).select(
      "-_id -__v -user",
    );
    if (!statistics) return null;
    statistics.set(
      "actualRtp",
      statistics.chipsWagered
        ? (statistics.chipsReturned / statistics.chipsWagered) * 100
        : null,
      { strict: false },
    );
    return statistics;
  },
  getHistory: (user) =>
    GameHistory.find({ user })
      .sort({ playedAt: -1, _id: -1 })
      .limit(historyLimit)
      .select("-__v -user")
      .lean(),
  async saveRound(game) {
    // One transaction includes every human's record and statistics. Retries cannot double-count.
    await mongoose.connection.transaction(async (session) => {
      const humans = game.players
        .filter((player) => !player.isBot)
        .sort((first, second) => first.id.localeCompare(second.id));
      for (const player of humans) {
        const statistics = await lockUserHistory(player.id, session);
        const key = { user: player.id, roundId: game.id };
        const exists =
          (await RoundReceipt.exists(key).session(session)) ||
          (await GameHistory.exists(key).session(session));
        await RoundReceipt.updateOne(
          key,
          { $setOnInsert: key },
          { session, upsert: true },
        );
        if (!exists) {
          await GameHistory.create(
            [
              {
                user: player.id,
                roundId: game.id,
                mode: game.mode,
                result: player.result,
                playerTotal: calculateHandTotal(player.hand),
                dealerTotal: calculateHandTotal(game.dealerHand),
                playedAt: game.completedAt,
              },
            ],
            { session },
          );
          const counter = { win: "wins", loss: "losses", push: "pushes" }[
            player.result
          ];
          statistics.totalGames += 1;
          statistics[counter] += 1;
          statistics.winPercentage = Number(
            ((statistics.wins / statistics.totalGames) * 100).toFixed(2),
          );
          await statistics.save({ session });
        }
        await settleBet(game, player, statistics, session);
        while (
          (await pruneHistoryBatch(player.id, session)) === cleanupBatchSize
        ) {
          // Normally at most one row; also tolerate legacy data awaiting cleanup.
        }
      }
    });
  },
};
