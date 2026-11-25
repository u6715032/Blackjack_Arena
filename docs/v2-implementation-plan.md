# Blackjack Arena V2 implementation plan and audit

## Existing architecture and risks

React/Vite uses cookie-authenticated REST for single-player and a page-scoped
Socket.IO connection for multiplayer. Express owns the blackjack engine, room
membership and 30-second turn timer. Games, shoes and room state exist only in
one server process. MongoDB transactions save history and statistics; duplicate
receipts survive pruning. Python FastAPI serves the existing PyTorch model, while
TensorFlow is used for offline training. Neither model nor training data is changed.

The in-memory game design cannot safely debit wagers without durable bet records
and a restart policy. Shared social sockets must preserve the existing semantics
of last-socket disconnects. Multi-document economy operations require a replica
set and unique ledger keys, and test code must never use the application's URI.

## Phases

1. Audit, baseline tests and this plan: completed.
2. Wallet, opening balances, daily reward and balance display: initial implementation;
   MongoDB concurrency and migration tests execute against a dedicated replica set.
3. Betting: persist each wager before exposing a round, settle with game history
   in one transaction, establish recovery/refunds and transparent payout rules;
   synchronize individual multiplayer bets before dealing. Add RTP analytics and
   unbiased simulations.
4. Wheel and leaderboard: transactional, cryptographically selected outcomes,
   disclosed probabilities and indexed rankings.
5. Friendships and private messages: authorization, presence and retention, while
   preserving room disconnect behavior.
6. Transfers and loans: atomic receipts, explicit consent, overdue restrictions
   and durable obligations independent of chat retention.
7. Responsive homepage and shared game-table redesign.
8. End-to-end, concurrency, browser, recovery and security verification; complete
   API, schema, architecture and economic documentation.

Only phases 1 and the initial wallet foundation are present. Later phases are
not implemented and no claim of full V2 completion is made.

## Wallet migration and rollback considerations

New account creation initializes `User.chips` and an `opening` ledger entry in
the same transaction as the account and statistics. A legacy account without the
field is initialized on first login or session restoration, using a conditional
update and the unique `opening:<user id>` key. Concurrent access serializes on
the user document; the daily reward timestamp, credit and ledger entry commit
together. The operation does not touch history or statistics. Back up the
database before deployment and use a replica set. Rolling back application code
does not remove new fields or ledger entries; never reset balances during rollback.

The timestamp uses the application server's UTC clock, so hosts need synchronized
clocks. Daily rewards do not accumulate. This initial ledger supports credits;
it is not yet a complete debit/transfer/settlement system. The current interface
updates balance when a session is established, not by cross-tab notifications.

## Baseline and current verification

Baseline: `npm test` 38 passed; `npm run test:ai` 40 passed; `npm run build`
passed. Wallet test: one dedicated MongoDB replica-set integration test passed,
covering opening balances, legacy statistics preservation, eight concurrent
claims, cooldown boundary, authenticated endpoints and ledger counts. The full
database integration suite passed nine tests using a local disposable replica set
and a live local AI service. Browser tests and V2 features beyond the wallet have
not been verified.
