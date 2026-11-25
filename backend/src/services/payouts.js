// Multipliers include the original stake; integer division rounds down.
export const PAYOUT_RULES = Object.freeze({
  "standard-v1": Object.freeze({ win: [2, 1], natural: [5, 2] }),
  "experimental-boost-v1": Object.freeze({ win: [21, 10], natural: [5, 2] }),
});
export function selectPayoutRule(mode, statistics) {
  return mode === "experimental" &&
    statistics?.totalGames >= 10 &&
    statistics.wins / statistics.totalGames < 0.4
    ? "experimental-boost-v1"
    : "standard-v1";
}
