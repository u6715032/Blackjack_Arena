# Three-member learning and maintenance plan

Member 1 leads React, UI/UX, reusable components, accessibility, and state flow.
Member 2 leads Express, MongoDB, authentication, and Socket.IO. Member 3 leads the
Blackjack engine, neural network, FastAPI, and evaluation. “Lead” means first
reviewer and maintainer, not the only person allowed to understand that area.

Each week schedule two individual implementation/debugging sessions and one
90-minute team integration session. Rotate the person who drives the shared
keyboard. Every member should explain a request from browser through persistence
and explain the distinction between model preference and chance of winning.

| Week | Member 1 hands-on work | Member 2 hands-on work | Member 3 hands-on work | Shared evidence / review |
| --- | --- | --- | --- | --- |
| 1 | Run React; trace Home and routes; sketch responsive table | Start backend with own secret config; trace startup | Load original/expanded checkpoints and inspect metadata | All independently run the app; agree on excluded features and rules |
| 2 | Reproduce PlayingCard in a scratch branch using props | Reproduce one protected GET route in a scratch branch | Reproduce Ace scoring without reading implementation first | Compare solutions; draw architecture and trust boundaries |
| 3 | Trace state from deal click to returned table | Trace route handler to game service and engine | Write natural/ordinary-21 examples and explain result order | Add one meaningful engine edge-case test together |
| 4 | Use Network tab to inspect hidden-card masking | Attempt forged/out-of-turn/stale requests using test clients | Deliberately break dealer S17; locate failing test and fix | Document the bug cause and restored rule; review privacy |
| 5 | Improve one form label/error presentation and test mobile | Reproduce bcrypt login + JWT verification in scratch branch | Pair with Member 2 to trace auth on a game request | Explain cookies, SameSite, expiry, origin checks; test logout |
| 6 | Build a small statistics display from real API output | Use a disposable account to inspect history/statistics relationships | Review transaction idempotency and unique round index | Stop/restart backend; prove saved history remains |
| 7 | Follow room events and waiting-room state updates | Reproduce create/join capacity checks; test invalid room code | Pair on a deterministic multiplayer turn fixture | Four local Socket.IO clients synchronize; show rejected fifth join |
| 8 | Test navigation/disconnect and two tabs of one account | Debug host transfer and last-socket disconnect behavior | Trace disconnected-hand status through dealer completion | Demonstrate chosen policy, including reconnect not undoing stand |
| 9 | Display a real advice result and stale-advice clearing | Trace Express-to-FastAPI request and timeout behavior | Reproduce normalized inputs and one network forward pass | All calculate the 234 parameters and explain ReLU/Softmax |
| 10 | Pair with Member 3 on model/reference disagreement UI | Write/test one malformed AI response or outage case | Retrain expanded model into a separate experiment directory | Record actual loss/accuracy; preserve baseline weights and compare |
| 11 | Pair on a browser test that checks advice never auto-acts | Pair on actual Atlas persistence/cleanup integration test | Verify new experiment's TensorFlow/PyTorch numerical parity | Review test isolation; distinguish fixture predictions from real inference |
| 12 | Test 390px and desktop layouts; fix an observed overflow | Check session revocation, protected history, limits and error sanitization | Test reachable >6-card bot/assistant cases | Run full test matrix and frontend build; track actual failures |
| 13 | Swap to backend ownership for a small reviewed change | Swap to engine/AI ownership for a small reviewed change | Swap to frontend ownership for a small reviewed change | Each explains and debugs code outside primary area; prepare demo backup |
| 14 | Prepare UI demonstration and accessibility explanation | Prepare database and multiplayer demonstration | Prepare training methodology, confusion matrix and limitation explanation | Mock defense: each answers architecture/AI/security questions; update report figures |
| 15 | Verify demo layout and account flows from a clean checkout | Verify configuration instructions and full integration checks | Verify original hashes, trained artifacts and evaluation commands | Rehearse timed defense; tag reviewed local version; submit honest limitations and results |

## Weekly practice rules

Use branches or local commits for exercises, and keep secrets out of commits and
presentation screenshots. Before changing an algorithm, predict which test should
fail and why. After fixing it, explain the root cause in your own words. Avoid
tests that simply repeat the implementation without checking an observable rule.

Use disposable accounts for persistence experiments. Never simulate an outage by
deleting real user data. Stop a local service or use the isolated test repository.
Restart the service and verify recovery, including the visible retry state.

At the end of each week each member should deliver a small implementation,
an executed check or recorded bug investigation, a short explanation of the
relevant data flow, and one review of another member's work. Reading the generated
source alone does not satisfy the plan.

## Maintenance ownership after the defense

Member 1 checks UI contracts when API fields change. Member 2 reviews changes to
session handling, indexes, persistence, and socket membership. Member 3 reviews
rules, feature order, normalization, checkpoint metadata, and measured evaluation.
Any model replacement requires architecture/preprocessing checks and fresh
TensorFlow/PyTorch parity results; any rules change requires engine tests and
reconsideration of reachable training states. All members review the verification
report and known limits before claiming a new release is ready.
