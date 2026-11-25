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
    lastWheelSpinAt: { type: Date, default: null },
    socialVersion: { type: Number, default: 0 },
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

const wheelSpinSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestId: { type: String, required: true },
    prize: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    prizeIndex: { type: Number, required: true, min: 0 },
    cost: { type: Number, required: true },
  },
  { timestamps: true },
);
wheelSpinSchema.index({ user: 1, requestId: 1 }, { unique: true });
wheelSpinSchema.index({ user: 1, createdAt: -1 });

const friendshipSchema = new Schema(
  {
    first: { type: Schema.Types.ObjectId, ref: "User", required: true },
    second: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "accepted"], required: true },
  },
  { timestamps: true },
);
friendshipSchema.index({ first: 1, second: 1 }, { unique: true });
friendshipSchema.index({ second: 1, status: 1 });
const blockSchema = new Schema(
  {
    blocker: { type: Schema.Types.ObjectId, ref: "User", required: true },
    blocked: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
const messageSchema = new Schema(
  {
    conversation: { type: String, required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, maxlength: 1000 },
    readAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
messageSchema.index({ conversation: 1, createdAt: -1, _id: -1 });
messageSchema.index({ recipient: 1, sender: 1, readAt: 1 });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const maintenanceSchema = new Schema({
  key: { type: String, required: true, unique: true },
  nextChatCleanupAt: { type: Date, required: true },
  version: { type: Number, default: 0 },
});

const loanSchema = new Schema(
  {
    lender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    borrower: { type: Schema.Types.ObjectId, ref: "User", required: true },
    initiatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestId: { type: String, required: true },
    principal: {
      type: Number,
      required: true,
      min: 1,
      validate: Number.isSafeInteger,
    },
    outstanding: {
      type: Number,
      required: true,
      min: 0,
      validate: Number.isSafeInteger,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "declined",
        "cancelled",
        "repaid",
        "overdue",
      ],
      required: true,
    },
    acceptedAt: Date,
    deadline: Date,
    repayments: [
      {
        amount: { type: Number, required: true },
        at: { type: Date, required: true },
        requestId: { type: String, required: true },
      },
    ],
  },
  { timestamps: true },
);
loanSchema.index({ initiatedBy: 1, requestId: 1 }, { unique: true });
loanSchema.index({ borrower: 1, status: 1, deadline: 1 });
loanSchema.index({ lender: 1, status: 1 });
const transferSchema = new Schema(
  {
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);
transferSchema.index({ sender: 1, requestId: 1 }, { unique: true });
const repaymentSchema = new Schema(
  {
    borrower: { type: Schema.Types.ObjectId, ref: "User", required: true },
    loan: { type: Schema.Types.ObjectId, ref: "Loan", required: true },
    requestId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);
repaymentSchema.index({ borrower: 1, requestId: 1 }, { unique: true });

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
export const WheelSpin = mongoose.model("WheelSpin", wheelSpinSchema);
export const Friendship = mongoose.model("Friendship", friendshipSchema);
export const Block = mongoose.model("Block", blockSchema);
export const Message = mongoose.model("Message", messageSchema);
export const Maintenance = mongoose.model("Maintenance", maintenanceSchema);
export const Loan = mongoose.model("Loan", loanSchema);
export const ChipTransfer = mongoose.model("ChipTransfer", transferSchema);
export const LoanRepayment = mongoose.model("LoanRepayment", repaymentSchema);
export const GameHistory = mongoose.model("GameHistory", historySchema);
export const RoundReceipt = mongoose.model("RoundReceipt", receiptSchema);
export const PlayerStatistics = mongoose.model(
  "PlayerStatistics",
  statisticsSchema,
);
