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
not guarantees or exact probabilities.

At deal, all humans' debits and pending bet records commit in one MongoDB
transaction. Settlement, ledger credits, game history and statistics commit in
one transaction. At server startup, every remaining pending bet is refunded once;
active game state is not recovered. This requires a single backend instance per
database. A crash after a result is visible but before its save commits can refund
the wager instead of settling that result. Never run startup recovery against a
database used by another live server. MongoDB must be a replica set.
