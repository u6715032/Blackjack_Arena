import mongoose from "mongoose";
import { Bet, PlayerStatistics } from "../models/index.js";
import { creditWallet, debitWallet, initializeWallet } from "./wallet.js";
import { isNaturalBlackjack } from "../game/engine.js";
import { PAYOUT_RULES, selectPayoutRule } from "./payouts.js";

export const PAYOUT_RULE = "standard-v1";
export const MAX_BET = 1000000;

export function validateBet(amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_BET) {
    const error = new Error(
      `Bet must be a whole number from 1 to ${MAX_BET} chips.`,
    );
    error.status = 400;
    throw error;
  }
}

export function payout(amount, result, natural, rule = PAYOUT_RULE) {
  validateBet(amount);
  if (result === "loss") return 0;
  if (result === "push") return amount;
  if (result !== "win") throw new Error("Invalid game result.");
  const config = PAYOUT_RULES[rule];
  if (!config) throw new Error("Unknown payout rule.");
  const [numerator, denominator] = natural ? config.natural : config.win;
  return Math.floor((amount * numerator) / denominator);
}

export async function placeBets(game) {
  const players = game.players
    .filter((p) => !p.isBot)
    .sort((a, b) => a.id.localeCompare(b.id));
  players.forEach((p) => validateBet(p.wager));
  const rules = await mongoose.connection.transaction(async (session) => {
    const selected = {};
    for (const player of players) {
      const statistics = await PlayerStatistics.findOne({ user: player.id })
        .session(session)
        .lean();
      const rule = selectPayoutRule(
        game.mode === "single" ? player.payoutMode : "standard",
        statistics,
      );
      selected[player.id] = rule;
      await initializeWallet(player.id, session);
      await debitWallet({
        userId: player.id,
        amount: player.wager,
        key: `bet:${game.id}:${player.id}`,
        kind: "bet",
        session,
      });
      await Bet.create(
        [
          {
            user: player.id,
            roundId: game.id,
            mode: game.mode,
            amount: player.wager,
            payoutRule: rule,
          },
        ],
        { session },
      );
    }
    return selected;
  });
  for (const player of players) player.payoutRule = rules[player.id];
}

// Called inside the history/statistics transaction; repeated saves are harmless.
export async function settleBet(game, player, statistics, session) {
  const bet = await Bet.findOne({ user: player.id, roundId: game.id }).session(
    session,
  );
  if (!bet || bet.status === "settled") return;
  if (bet.status !== "pending")
    throw new Error("Cannot settle a refunded wager.");
  const returned = payout(
    bet.amount,
    player.result,
    isNaturalBlackjack(player.hand),
    bet.payoutRule,
  );
  if (returned)
    await creditWallet({
      userId: player.id,
      amount: returned,
      key: `settle:${game.id}:${player.id}`,
      kind: "settlement",
      session,
    });
  bet.status = "settled";
  bet.returned = returned;
  await bet.save({ session });
  statistics.chipsWagered = (statistics.chipsWagered || 0) + bet.amount;
  statistics.chipsReturned = (statistics.chipsReturned || 0) + returned;
  await statistics.save({ session });
}

// Single-server startup only: active rounds are in memory and cannot be resumed.
export async function refundPendingBets() {
  const cursor = Bet.find({ status: "pending" }).select("_id").cursor();
  for await (const { _id } of cursor) {
    await mongoose.connection.transaction(async (session) => {
      const bet = await Bet.findOne({ _id, status: "pending" }).session(
        session,
      );
      if (!bet) return;
      await creditWallet({
        userId: bet.user,
        amount: bet.amount,
        key: `refund:${bet.roundId}:${bet.user}`,
        kind: "refund",
        session,
      });
      bet.status = "refunded";
      bet.returned = bet.amount;
      await bet.save({ session });
    });
  }
}
