# Development checkpoints

The original repository had two Python scripts, original `.keras` / `.pt` artifacts,
the proposal, and private backend configuration. Frontend/backend implementation
directories were empty. Original models and `blackjack_nn.py` are retained.

## Milestone 1 — setup

Inspected the original code and readable DOCX text. All five required environment
keys were present; values were not printed. Confirmed original architecture,
STAND/HIT mapping, normalization `[21,11,1,6]`, and the 2–6-card data limitation.
Prepared JavaScript npm workspaces and Python requirements. Database connectivity
and installed dependency versions are verified in the final verification report.

Git checkpoints are local commits; no remote push is performed.

## Milestone 2 — engine

Implemented separate shoe/shuffle/draw/scoring/Ace/natural/legal-action/HIT/STAND/
dealer/result functions and permitted serialization. The first 21 engine tests
passed. Crypto Fisher–Yates and server-only cards establish game authority.

## Milestone 3 — frontend

Built React pages, reusable table components, form flows, profile/history,
Socket.IO lobby/table, strategy assistant, and responsive plain CSS. Vite's first
production build passed. Later browser verification fixed accessible label text
and made logout consistently navigate to login.

## Milestone 4 — model

Inspected real checkpoint tensor shapes/metadata and verified original TensorFlow
versus PyTorch parity. Preserved original script/artifacts. Enumerated 2,190
reachable tuples through 20 cards and trained the same architecture in real
TensorFlow for 600 epochs. Held-out accuracy 327/329; all-state conversion actions
agree. All 23 Python tests passed. Recorded actual model and simulation JSON.

## Milestone 5 — accounts/database

Connected to the configured Atlas database without exposing private values.
Implemented validated registration/login, bcrypt, JWT cookies, token-version
logout revocation, protected profiles/history/statistics, unique indexes, and
transactional idempotent result saving. A real Atlas integration test passed,
including temporary account creation and targeted cleanup.

## Milestone 6 — multiplayer

Implemented authenticated rooms for 2–4 humans, host start, shared dealer,
turn/revision validation, bounded events, permitted broadcasts, replay, multiple
socket tracking, and disconnect-as-stand. Actual local Socket.IO clients tested
capacity, invalid rooms, host authorization, wrong/duplicate actions, hidden
cards, synchronized completion, and disconnection.

## Milestone 7 — integration

Started all three actual services. The initial fixed-port Vite proxy did not
match the existing private port; corrected it to select only backend PORT at
configuration time. Real Atlas/FastAPI tests covered bot and advice flows,
duplicate saving, and >6-card bot/human advice. Two Chrome browser flows passed,
including mobile overflow and persistent profile/history.

## Milestone 8 — quality/security

Added regressions for host transfer, stale advice, reconnect not reopening turns,
and retaining a failed-save room on leave. Removed stale connection-status
entries. Made the socket fixture deterministic. JavaScript suite reached 30
passing tests. Production npm advisory audit reported zero vulnerabilities.
Formatted JavaScript/JSX/CSS for beginner readability.

## Milestone 9 — learning documentation

Wrote exact setup commands, ten teaching chapters, 36 defense Q&As, API contracts,
15-week hands-on team plan, model-change explanation, and known operating limits.
Documentation distinguishes isolated tests from actual Atlas/model/browser work.

## Milestone 10 — verification

Final checks and measured results are recorded in `verification-report.md`.
Original hashes and environment tracked/ignored status are checked without
reading private values into output. No remote push or public deployment occurs.
