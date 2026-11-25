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
2. Wallet, opening balances, daily reward and balance display: implemented;
   MongoDB concurrency and migration tests execute against a dedicated replica set.
3. Betting: implemented durable wagers, settlement, startup refunds,
   player-selected multiplayer wagers, observed RTP, payout configurations and
   simulation. A process crash/restart and browser wagers were tested.
4. Wheel and leaderboard: implemented transactional,
   cryptographically selected outcomes, disclosed probabilities, spin receipts,
   animation, indexed balance rankings and optional debt-adjusted rankings.
5. Friendships and private messages: implemented request lifecycle, blocking,
   presence, authorized chat and retention with a separate social socket. Browser
   flows, expiry and a scheduled cleanup after process restart were tested.
6. Transfers and loans: implementation includes atomic receipts, explicit
   consent, partial repayment, overdue restrictions and durable obligations.
   Browser and concurrent operations were tested, including repayment after a
   server restart and chat cleanup.
7. Responsive dashboard and shared game-table redesign: implemented, including
   dealt-card and chip animations and an optional sound toggle. The two-account
   browser journey and desktop/mobile screenshots were exercised; a formal
   accessibility audit remains future work.
8. End-to-end, concurrency, browser, recovery and security verification: local
   checks executed and documented in [the verification report](verification-report.md).
   Independent security review, load testing and multi-instance deployment remain
   future work.

Phases 1–8 have local implementations and verification. They are not a claim of
production readiness or multi-instance support.

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
clocks. Daily rewards do not accumulate. The ledger supports wager debits,
settlement, refunds, transfers and loan operations.
Authenticated sockets notify connected tabs after relevant balance changes.

## Baseline and current verification

Baseline: `npm test` 38 passed; `npm run test:ai` 40 passed; `npm run build`
passed. The later V2 run passed 40 backend tests, 40 AI tests, 14 database
integration tests and nine browser tests. See the verification report for the
test environment, additional multiplayer wager check, measured simulations and
limitations.
