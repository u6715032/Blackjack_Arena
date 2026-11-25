import mongoose from "mongoose";

const { Schema } = mongoose;
const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      minlength: 3,
      maxlength: 24,
    },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    tokenVersion: { type: Number, default: 0 },
    chips: { type: Number, min: 0, validate: Number.isSafeInteger },
    lastDailyRewardAt: { type: Date, default: null },
  },
  { timestamps: true },
);
userSchema.index({ chips: -1, _id: 1 });

const chipTransactionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    key: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    amount: { type: Number, required: true, validate: Number.isSafeInteger },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
  },
  { timestamps: true },
);
chipTransactionSchema.index({ user: 1, createdAt: -1, _id: -1 });

const betSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    roundId: { type: String, required: true },
    mode: { type: String, enum: ["single", "multi"], required: true },
    amount: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    status: {
      type: String,
      enum: ["pending", "settled", "refunded"],
      default: "pending",
      required: true,
    },
    returned: {
      type: Number,
      min: 0,
      default: 0,
      validate: Number.isSafeInteger,
    },
    payoutRule: { type: String, required: true },
  },
  { timestamps: true },
);
betSchema.index({ user: 1, roundId: 1 }, { unique: true });
betSchema.index({ status: 1, _id: 1 });

const historySchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  roundId: { type: String, required: true },
  mode: { type: String, enum: ["single", "multi"], required: true },
  result: { type: String, enum: ["win", "loss", "push"], required: true },
  playerTotal: { type: Number, required: true },
  dealerTotal: { type: Number, required: true },
  playedAt: { type: Date, required: true },
});
historySchema.index({ user: 1, roundId: 1 }, { unique: true });
historySchema.index({ user: 1, playedAt: -1, _id: -1 });

// Minimal idempotency keys outlive pruned history; they contain no round results.
const receiptSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  roundId: { type: String, required: true },
});
receiptSchema.index({ user: 1, roundId: 1 }, { unique: true });

const statisticsSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    totalGames: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    pushes: { type: Number, default: 0 },
    winPercentage: { type: Number, default: 0 },
    chipsWagered: { type: Number, default: 0 },
    chipsReturned: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
export const ChipTransaction = mongoose.model(
  "ChipTransaction",
  chipTransactionSchema,
);
export const Bet = mongoose.model("Bet", betSchema);
export const GameHistory = mongoose.model("GameHistory", historySchema);
export const RoundReceipt = mongoose.model("RoundReceipt", receiptSchema);
export const PlayerStatistics = mongoose.model(
  "PlayerStatistics",
  statisticsSchema,
);
