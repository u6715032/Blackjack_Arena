import mongoose from "mongoose";
import { Loan, ChipTransfer, LoanRepayment } from "../models/index.js";
import { creditWallet, debitWallet, initializeWallet } from "./wallet.js";
import { pair, lockPair, requireFriends, fail } from "./social.js";

export const LOAN_LIMIT = 500;
export const LOAN_DURATION_MS = 72 * 60 * 60 * 1000;
const MAX_TRANSFER = 1000000;
function validateAmount(amount, max) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > max)
    fail(`Amount must be a whole number from 1 to ${max} chips.`);
}
function validateRequestId(value) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    fail("Provide a valid request ID.");
}
async function hasOverdue(userId, now, session) {
  return Boolean(
    await Loan.exists({
      borrower: userId,
      status: { $in: ["accepted", "overdue"] },
      outstanding: { $gt: 0 },
      deadline: { $lte: now },
    }).session(session),
  );
}
async function allowOutgoing(userId, now, session) {
  if (await hasOverdue(userId, now, session))
    fail("Repay your overdue loan before sending or lending chips.", 409);
}
async function allowBorrowing(userId, now, session) {
  if (await hasOverdue(userId, now, session))
    fail("Repay your overdue loan before borrowing more chips.", 409);
}
async function borrowedTotal(userId, session, includePending = false) {
  const states = [{ status: { $in: ["accepted", "overdue"] } }];
  if (includePending) states.push({ status: "pending", initiatedBy: userId });
  const loans = await Loan.find({ borrower: userId, $or: states })
    .select("outstanding")
    .session(session)
    .lean();
  return loans.reduce((sum, loan) => sum + loan.outstanding, 0);
}
async function move(sender, recipient, amount, key, kind, session) {
  await initializeWallet(sender, session);
  await initializeWallet(recipient, session);
  await debitWallet({
    userId: sender,
    amount,
    key: `${key}:debit`,
    kind: `${kind}-debit`,
    session,
  });
  await creditWallet({
    userId: recipient,
    amount,
    key: `${key}:credit`,
    kind: `${kind}-credit`,
    session,
  });
}
export async function transferChips(
  sender,
  recipient,
  amount,
  requestId,
  now = new Date(),
) {
  validateAmount(amount, MAX_TRANSFER);
  validateRequestId(requestId);
  const { first, second } = pair(sender, recipient);
  return mongoose.connection.transaction(async (session) => {
    await lockPair(first, second, session);
    const existing = await ChipTransfer.findOne({ sender, requestId })
      .session(session)
      .lean();
    if (existing) {
      if (
        String(existing.recipient) !== String(recipient) ||
        existing.amount !== amount
      )
        fail("Request ID was already used with different terms.", 409);
      return existing;
    }
    await requireFriends(first, second, session);
    await allowOutgoing(sender, now, session);
    await move(
      sender,
      recipient,
      amount,
      `transfer:${sender}:${requestId}`,
      "transfer",
      session,
    );
    const [receipt] = await ChipTransfer.create(
      [{ sender, recipient, amount, requestId }],
      { session },
    );
    return receipt.toObject();
  });
}
export async function createLoan(
  userId,
  otherId,
  direction,
  amount,
  requestId,
  now = new Date(),
) {
  validateAmount(amount, LOAN_LIMIT);
  validateRequestId(requestId);
  if (!["borrow", "lend"].includes(direction)) fail("Choose borrow or lend.");
  const { first, second } = pair(userId, otherId);
  const borrower = direction === "borrow" ? userId : otherId;
  const lender = direction === "borrow" ? otherId : userId;
  return mongoose.connection.transaction(async (session) => {
    await lockPair(first, second, session);
    const existing = await Loan.findOne({ initiatedBy: userId, requestId })
      .session(session)
      .lean();
    if (existing) {
      if (
        String(existing.borrower) !== String(borrower) ||
        String(existing.lender) !== String(lender) ||
        existing.principal !== amount
      )
        fail("Request ID was already used with different terms.", 409);
      return existing;
    }
    await requireFriends(first, second, session);
    await allowBorrowing(borrower, now, session);
    if (
      await Loan.exists({ borrower, lender, status: "pending" }).session(
        session,
      )
    )
      fail("A loan request between these players is already pending.", 409);
    if (
      (await borrowedTotal(borrower, session, direction === "borrow")) +
        amount >
      LOAN_LIMIT
    )
      fail(
        `Borrowing limit is ${LOAN_LIMIT} chips including pending requests.`,
        409,
      );
    const [loan] = await Loan.create(
      [
        {
          lender,
          borrower,
          initiatedBy: userId,
          requestId,
          principal: amount,
          outstanding: amount,
          status: "pending",
        },
      ],
      { session },
    );
    return loan.toObject();
  });
}
export async function participantLoan(userId, loanId) {
  if (!mongoose.isValidObjectId(loanId)) fail("Loan not found.", 404);
  const loan = await Loan.findById(loanId).lean();
  if (
    !loan ||
    ![String(loan.borrower), String(loan.lender)].includes(String(userId))
  )
    fail("Loan not found.", 404);
  return loan;
}
export async function respondLoan(userId, loanId, action, now = new Date()) {
  if (!["accept", "decline", "cancel"].includes(action))
    fail("Unknown loan action.");
  const original = await participantLoan(userId, loanId);
  const { first, second } = pair(original.borrower, original.lender);
  return mongoose.connection.transaction(async (session) => {
    await lockPair(first, second, session);
    const loan = await Loan.findById(loanId).session(session);
    const initiator = String(loan.initiatedBy) === String(userId);
    if ((action === "cancel") !== initiator)
      fail("You cannot perform this action.", 403);
    const completed = {
      accept: ["accepted", "overdue", "repaid"],
      decline: ["declined"],
      cancel: ["cancelled"],
    };
    if (completed[action].includes(loan.status)) return loan.toObject();
    if (loan.status !== "pending")
      fail("This loan request is no longer pending.", 409);
    if (action === "accept") {
      await requireFriends(first, second, session);
      await allowBorrowing(loan.borrower, now, session);
      await allowOutgoing(loan.lender, now, session);
      if (
        (await borrowedTotal(loan.borrower, session)) + loan.principal >
        LOAN_LIMIT
      )
        fail("Borrowing limit exceeded.", 409);
      await move(
        loan.lender,
        loan.borrower,
        loan.principal,
        `loan:${loan.id}`,
        "loan",
        session,
      );
      loan.status = "accepted";
      loan.acceptedAt = now;
      loan.deadline = new Date(now.getTime() + LOAN_DURATION_MS);
    } else loan.status = action === "decline" ? "declined" : "cancelled";
    await loan.save({ session });
    return loan.toObject();
  });
}
export async function repayLoan(
  userId,
  loanId,
  amount,
  requestId,
  now = new Date(),
) {
  validateAmount(amount, LOAN_LIMIT);
  validateRequestId(requestId);
  const original = await participantLoan(userId, loanId);
  if (String(original.borrower) !== String(userId))
    fail("Only the borrower can repay this loan.", 403);
  const { first, second } = pair(original.borrower, original.lender);
  return mongoose.connection.transaction(async (session) => {
    await lockPair(first, second, session);
    const prior = await LoanRepayment.findOne({ borrower: userId, requestId })
      .session(session)
      .lean();
    if (prior) {
      if (String(prior.loan) !== String(loanId) || prior.amount !== amount)
        fail("Request ID was already used with different terms.", 409);
      return prior;
    }
    const loan = await Loan.findById(loanId).session(session);
    if (
      !["accepted", "overdue"].includes(loan.status) ||
      amount > loan.outstanding
    )
      fail(
        "Repayment exceeds the outstanding loan or the loan is closed.",
        409,
      );
    await move(
      loan.borrower,
      loan.lender,
      amount,
      `repay:${userId}:${requestId}`,
      "repayment",
      session,
    );
    loan.outstanding -= amount;
    loan.status =
      loan.outstanding === 0
        ? "repaid"
        : loan.deadline <= now
          ? "overdue"
          : "accepted";
    loan.repayments.push({ amount, at: now, requestId });
    await loan.save({ session });
    const [receipt] = await LoanRepayment.create(
      [{ borrower: userId, loan: loanId, amount, requestId }],
      { session },
    );
    return receipt.toObject();
  });
}
export async function markOverdue(now = new Date()) {
  const result = await Loan.updateMany(
    {
      status: "accepted",
      outstanding: { $gt: 0 },
      deadline: { $lte: now },
    },
    { $set: { status: "overdue" } },
  );
  return result.modifiedCount;
}
export async function listLoans(userId, now = new Date()) {
  // Restrictions also evaluate deadlines directly, even between scheduled updates.
  await Loan.updateMany(
    {
      borrower: userId,
      status: "accepted",
      outstanding: { $gt: 0 },
      deadline: { $lte: now },
    },
    { $set: { status: "overdue" } },
  );
  const party = { $or: [{ borrower: userId }, { lender: userId }] };
  const query = (statuses) =>
    Loan.find({ ...party, status: { $in: statuses } })
      .sort({ createdAt: -1 })
      .populate("borrower", "username")
      .populate("lender", "username")
      .lean();
  const [open, closed] = await Promise.all([
    query(["pending", "accepted", "overdue"]),
    query(["declined", "cancelled", "repaid"]).limit(100),
  ]);
  const loans = [...open, ...closed];
  return loans.map((loan) => ({
    id: String(loan._id),
    lender: { id: String(loan.lender._id), username: loan.lender.username },
    borrower: {
      id: String(loan.borrower._id),
      username: loan.borrower.username,
    },
    initiatedBy: String(loan.initiatedBy),
    principal: loan.principal,
    outstanding: loan.outstanding,
    status: loan.status,
    requestedAt: loan.createdAt,
    acceptedAt: loan.acceptedAt || null,
    deadline: loan.deadline || null,
    repayments: loan.repayments.map(({ amount, at }) => ({ amount, at })),
  }));
}
