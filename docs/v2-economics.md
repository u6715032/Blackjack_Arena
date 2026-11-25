# Blackjack payouts, RTP and recovery

All values are virtual integer chips. Standard returns are 0 for a loss, 1×
stake for a push, 2× for an ordinary win and 2.5× for a natural blackjack win.
The server rounds each return down to a whole chip. This affects small wagers:
a one-chip natural returns two chips. Experimental single-player mode applies
2.1× on ordinary wins only when the player has at least ten recorded games and
fewer than 40% wins before the new round. Otherwise it uses standard rates.
The chosen rule is stored on the bet. Multiplayer always uses standard rates.
Neither configuration alters shuffling, the deck or game results.

Observed RTP = 100 × settled chips returned / settled chips wagered. Refunded
rounds are excluded. Win percentage = 100 × wins / completed saved games and is
not RTP: pushes and different payouts matter. Theoretical RTP is the expected
return under stated rules and player strategy; house advantage is 100% minus
theoretical RTP. This implementation does not claim an exact theoretical value.
For a reproducible method, run `node backend/scripts/simulate-rtp.js 10000`.
It samples fresh cryptographically shuffled six-deck shoes with a simple
hit-below-17 strategy and a ten-chip stake, and reports sample estimates. Sampling
error, strategy and integer rounding affect the results. Compare standard and
experimental estimates over the same simulated hands. A 10,000-round run during
development measured 93.625% standard and 97.249% boosted RTP; these are estimates,
not guarantees or exact probabilities. The script also reports estimated house
advantage and an illustrative per-player-day economy scenario: 100 ten-chip
rounds, one daily reward and one wheel spin. Its expected net is
`10 + 100 × 10 × (estimated RTP / 100 − 1) + 1.59 − 2`. Transfers and principal
loans redistribute existing chips and are excluded. This simplified scenario is
not a forecast of player behavior or long-term solvency.

At deal, all humans' debits and pending bet records commit in one MongoDB
transaction. Settlement, ledger credits, game history and statistics commit in
one transaction. At server startup, every remaining pending bet is refunded once;
active game state is not recovered. This requires a single backend instance per
database. A crash after a result is visible but before its save commits can refund
the wager instead of settling that result. Never run startup recovery against a
database used by another live server. MongoDB must be a replica set.

## Lucky wheel

Each spin costs 2 chips. Its six weighted outcomes are 0 chips (50%), 1 (20%),
2 (15%), 5 (10%), 10 (4.9%), and 100 (0.1%). Expected return is
`0×0.5 + 1×0.2 + 2×0.15 + 5×0.1 + 10×0.049 + 100×0.001 = 1.59`
chips; theoretical RTP is `1.59 / 2 × 100 = 79.5%`. Outcomes are selected
with Node's cryptographic random integer generator. Cost, prize, spin receipt,
and balance changes commit together. A five-second server cooldown prevents
overlapping spins; retrying the same UUID returns the original receipt.

Balance rankings exclude legacy accounts until their wallet is initialized.
Net holdings are the current balance minus accepted outstanding borrowing; they
can be negative. Pending and closed loans are excluded. Balances and rankings can
be influenced by transfers, loans, and multiple accounts; this leaderboard is
not a measure of blackjack skill. Public responses reveal only aggregate net
holdings, not lenders, borrowers, individual loans, or repayment histories.

## Transfers and loans

Accepted friends may transfer chips or propose a loan. A borrow request is
accepted by the lender; a lending offer is accepted by the borrower. Pending
requests may be declined by the recipient or cancelled by the initiator. The
maximum combined outstanding borrowing and borrower-initiated pending requests is
500 chips. Unaccepted lending offers do not consume that limit, and each pair may
have only one pending request in the same borrowing direction. Accepted loans
have a 72-hour deadline, no interest, and support partial repayment. Once overdue,
the borrower cannot send or lend chips or take another loan until all overdue
debt is repaid. Repayment remains possible after removal or blocking; loan and
ledger records are independent of chat retention. The server checks deadlines
on each restricted operation and marks overdue loans on startup and every minute.

The client supplies a unique UUID for each transfer, loan proposal and repayment;
repeating the same request with unchanged terms returns its original receipt.
Both wallet changes, the ledger entries and the financial record commit together.
Loan acceptance uses the persistent loan ID as its transaction key. Synchronized
server clocks are required for cooldowns and deadlines.
