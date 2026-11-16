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
  },
  { timestamps: true },
);

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
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
export const GameHistory = mongoose.model("GameHistory", historySchema);
export const RoundReceipt = mongoose.model("RoundReceipt", receiptSchema);
export const PlayerStatistics = mongoose.model(
  "PlayerStatistics",
  statisticsSchema,
);
