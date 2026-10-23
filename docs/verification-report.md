# Final implementation and verification report

Verified on **23 October 2026**, using the client's Asia/Bangkok date context.
This report describes local execution, not a public deployment or production
load test. All ten requested development milestones have local Git checkpoints.

## Completed

Implemented the React/Vite website, reusable cards/hands/table/assistant/lobby,
registration/login/logout, protected profile/history/statistics, server-authoritative
single-player with 0–2 neural bots, and Socket.IO rooms with 2–4 humans. The backend
uses the existing Atlas configuration; real connection and persistence were tested.

Implemented six-deck crypto shuffling, Ace scoring, natural precedence, HIT/STAND,
automatic ending at 21/bust, dealer S17, and win/loss/push resolution. Snapshots hide
the dealer card/total and remaining shoe until permitted. Actions require identity,
membership, correct turn, round ID, revision, and an available mutation lock.

Both AI features use the same genuinely trained expanded model through FastAPI.
The dealer is fixed-rule. A Python outage pauses a bot or reports advice failure;
there is no substitute strategy. Explanations disclose reference disagreement.

Completed ten learning chapters, 36 defense questions/answers, a 15-week hands-on
team plan, API/event documentation, placeholder environment examples, and exact
setup/test/build commands. Source is formatted JavaScript/JSX/CSS, not TypeScript.

## Executed verification

| Command/check | Actual final result | What it verifies |
| --- | --- | --- |
| `npm test` | **30 passed, 0 failed** | 21 engine cases plus account/API logic with isolated test repository, AI-outage/retry behavior, stale/duplicate moves, persistence retry, host/reconnect policy, real local Socket.IO clients |
| `npm run test:ai` | **23 passed** | Actual .pt loading, shared preprocessing, output mapping, legal/invalid states, >6 cards, original/incompatible/missing models, actual disagreements, entire-domain TensorFlow/PyTorch parity, original file hashes |
| `npm run test:database` | **2 passed** | Real configured Atlas and FastAPI: temporary registration/login, bcrypt storage, private records, actual bot/advice integration, durable history/stats, duplicate save prevention, 50% win-percentage calculation; actual >6-card bot and assistant inference |
| `npm run test:browser` | **2 passed** | Headless installed Chrome against all running services: real registration, advice without automatic action, two bots, saved history/profile, logout, 390px overflow check, independent-account rooms, synchronized turns, replay/leave |
| `npm run build` | **Passed** | Vite 7.3.7 production build, 79 modules; final JS about 327.43 kB (103.46 kB gzip), CSS 17.88 kB (4.75 kB gzip) |
| `npm audit --omit=dev --json` | **0 reported vulnerabilities** | npm advisory check for installed production dependencies at verification time |
| `git diff --check` | **Passed** | No whitespace errors in pending source changes |
| Original SHA-256 checks | **Passed** | Original training script and both original checkpoints remain unchanged |
| Environment tracking check | **Passed** | `backend/.env` is ignored; only placeholder `.env.example` files are tracked |
| Secret-copy check | **Passed** | Neither the configured MongoDB URI nor JWT secret occurs in tracked files or the compiled frontend; values were compared only in-process and not printed |
| Documentation checks | **Passed** | Ten learning chapters, at least 25 defense questions (actual 36), existing relative file links |

There are **57 passing automated cases across the four suites**. This is a count
of test cases, not a coverage percentage. No code-coverage or concurrency-load
percentage was measured. Test runtime varies by machine/network.

Setup commands actually executed included `npm install --no-fund --no-audit`,
`npm install --save-dev @playwright/test prettier --no-fund --no-audit`,
`python3 -m pip install --target .tools uv`, the workspace-local `uv python install
3.12 --install-dir .tools/python --cache-dir .tools/cache --no-bin`, Python 3.12
`-m venv ai-service/.venv`, and `uv pip install --python ai-service/.venv/bin/python
--cache-dir .tools/cache -r ai-service/requirements-training.txt`. Local inspection
also used `rg`, `git status`, `git log`, safe environment-key checks, DOCX ZIP/XML
extraction, and weights-only checkpoint loading. Private values were never shell
arguments. `npm ci` in the README is the clean-checkout reproduction command,
not a claim that the original installation used it.

The Python suite emits one installed Starlette/TestClient deprecation warning
about `httpx` support in favor of `httpx2`; the pinned test environment still passes.
Chrome's runner also printed a color-environment warning; it did not fail tests.
Screenshots were inspected at desktop and mobile sizes. Generated screenshots/
traces are local ignored artifacts under `test-results/`.

## What used real services versus test fixtures

`backend/tests/helpers.js` is explicitly test-only in-memory account/result storage.
The default account/route unit tests use that repository to isolate behavior.
Some service unit tests use a clearly labeled fixed prediction to test turn
control or failure recovery, not model performance.

Production `server.js` always connects the actual database service; it never
falls back to fake storage. The separate opt-in database integration suite uses
Atlas and real FastAPI predictions. The large-hand inference case uses an isolated
test repository for state control and the **real running model**. Python tests
load genuine saved weights. Browser flows register temporary real Atlas accounts
and use real Express/FastAPI services. Temporary users/results are deleted by
exact created IDs; unrelated account data is not modified.

The Socket.IO test uses actual authenticated network clients on ephemeral local
ports, including a rejected unauthenticated connection and five account sessions
to verify four-seat capacity. A deterministic supplied test shoe prevents random
initial naturals from skipping turn/privacy assertions. Production does not allow
clients to supply a shoe.

## Actual model evaluation

Training command executed:

```sh
ai-service/.venv/bin/python ai-service/train_expanded.py --epochs 600
```

Training really ran in TensorFlow 2.21.0 on Python 3.12.15; inference/export used
PyTorch 2.14.1 and NumPy 2.5.4. The exact installed Python packages are recorded
in `ai-service/requirements-lock.txt`.

| Measure | Recorded value |
| --- | --- |
| Architecture | 4 → 16 ReLU → 8 ReLU → 2 Softmax |
| Parameters | 234 |
| Seed / epochs | 42 / 600 |
| Reachable distinct feature tuples | 2,190 |
| Train / validation / test | 1,532 / 329 / 329 |
| Expanded scaling | `[21,11,1,20]` |
| Supported hand count | 2–20; a next decision needs at most 19 |
| Held-out reference-label agreement | 327/329 = **99.3921%** |
| Held-out cross-entropy | **0.02203259** |
| All-state reference agreement | 2,186/2,190 = **99.8174%** |
| All-state model/reference disagreements | **4** |
| Maximum TensorFlow/PyTorch score difference | **1.1920928955078125e-7** |
| TensorFlow/PyTorch actions | Identical for all 2,190 states |

Held-out confusion matrix (rows truth STAND/HIT, columns model STAND/HIT):

```text
216   0
  2 111
```

The four full-domain disagreements are:

| Total | Dealer | Usable Ace | Cards | Model | Reference |
| --- | --- | --- | --- | --- | --- |
| 12 | 3 | 0 | 9 | STAND | HIT |
| 12 | 3 | 0 | 10 | STAND | HIT |
| 12 | 3 | 0 | 11 | STAND | HIT |
| 12 | 4 | 0 | 2 | HIT | STAND |

Raw results: [evaluation JSON](../ai-service/models/expanded/evaluation.json).
The stratified split uses class, not card count; the held-out partition happens
to contain no 20-card tuple. Whole-domain parity and direct API tests cover that
terminal count. Accuracy is reference imitation, not win probability, and scores
were not calibrated. Enumeration weights rare and common feature tuples equally.

Offline simulation command executed:

```sh
ai-service/.venv/bin/python ai-service/evaluate_simulation.py
```

For 10,000 seeded rounds per policy, fresh six-deck shoe each round, the model
recorded **4,325 wins / 4,832 losses / 843 pushes** (43.25% win fraction). Reference
recorded **4,333 / 4,824 / 843**. Largest observed player hand was seven cards.
The policies start with the same random seed but different decisions change card
consumption. These observations do not establish statistical superiority or future
performance. See [simulation JSON](../ai-service/models/expanded/simulation.json).
Rare larger hands are additionally tested with deterministic legal sequences.

## Preservation and configuration

Original SHA-256 values checked before and after work:

```text
blackjack_nn.py
525c4a5938a3e34a07ff7c71a824eb4e53156083fd1e9ba9eceaa139823ae686
models/blackjack_nn.pt
19c95c28099b48d944f0fd2e16a1ced0b9f129d43176a2fe1d2c8b085c45405d
models/blackjack_nn.keras
2350205531509ac124ce008ee6860d1d3be2565bb4ddb3327378e0b760c00ba4
```

The proposal DOCX is preserved. Its readable text supported architecture and scope
decisions. Private `.env` values were not printed, changed, staged, or committed.
Existing configuration was used in-process for local Atlas integration. New model
artifacts are under `models/expanded/`; original weights were not replaced.

## Problems found and resolved

Initial sandbox networking/listening checks failed due to environment permissions;
reruns with approved local/network access passed. Python 3.14 lacked the suitable
training environment, so an isolated workspace Python 3.12 runtime and `.venv`
were installed rather than changing the user's global Python.

The initial frontend proxy assumed a default backend port, which differed from
the existing configuration. Vite now selects only the backend port in its Node
configuration. A real Chrome run found input hints interfering with exact
accessible labels; explicit label/hint associations fixed this. Logout navigation
was made consistently `/login`. Overlapping early browser runner attempts also
collided over artifact files; the final documented run was one runner/worker and
passed. Failed exploratory runs are not counted as successful verification.

Review found a room could otherwise lose an unsaved result when its final member
left. The final code retains that room and asks for saving retry. Additional
regression tests cover the behavior. Mongoose's deprecated update option was
changed to `returnDocument: 'after'`.

## Remaining limitations and unperformed work

No required local gameplay/account feature remains known broken after the final
checks. That statement is limited to executed tests and inspection; it does not
claim an exhaustive security audit.

- No public deployment, HTTPS/reverse-proxy setup, or multi-server hosting was performed.
- Active rooms, games, and locks are in one process. Restart resets active state;
  a failed-save result can be lost on restart. Completed committed data persists.
- No persistent idle-game expiration, turn timer, or durable event replay. A user
  who remains connected can wait indefinitely. One single-player snapshot per
  account remains in memory until replacement/restart.
- Disconnect stands the unfinished hand immediately. There is no grace window,
  and navigating away from the multiplayer page disconnects that page's socket.
- No password-reset/email-verification/account-editing features; not part of the
  required account scope. Logout intentionally revokes all sessions for that user.
- No real-device/screen-reader study, broad cross-browser matrix, high-load test,
  or public network resilience test was performed. Chrome desktop and 390px
  viewport checks are the measured browser evidence.
- The small model disagrees with four reference cases, has no card-composition
  input, and is not proven optimal or a win predictor. No user-study improvement
  or confidence-calibration result is claimed.
- The original proposal DOCX still describes its proposal-stage status. Learning
  guides and this report describe implementation; final university submission
  editing of the DOCX remains a separate task.

## Run the delivered application

The full [README](../README.md) contains setup, configuration, and commands. With
installed dependencies, start Python in one terminal:

```sh
cd ai-service
source .venv/bin/activate
python -m uvicorn blackjack_ai_api:app --host 127.0.0.1 --port 8000
```

From the repository root in a second terminal:

```sh
npm run dev
```

Open `http://localhost:5173`, register, and play. Use separate browser sessions
for different multiplayer accounts. Do not start duplicate servers on occupied
ports. Verification servers are stopped after the final checks; these commands
restart them. Local Git commits record milestones; nothing was pushed remotely.
