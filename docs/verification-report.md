# AI cleanup and application verification report

Verified on **24 October 2026** (Asia/Bangkok). This was a refactor of the existing
application, with no intended website, game-rule, authentication, or API-response
change. No public deployment or remote Git push was performed.

## Final AI structure and responsibilities

```text
ai-service/
├── blackjack_ai_api.py
├── model.py
├── train.py
├── models/
│   ├── blackjack_nn.pt
│   ├── blackjack_nn.keras
│   └── evaluation.json
├── tests/
│   ├── conftest.py
│   └── test_model.py
├── requirements.txt
└── requirements-lock.txt
```

Study `model.py` for legal states, reference labeling, preprocessing, the network,
model loading, and conversion utilities. Study `train.py` for actual TensorFlow
training and measured evaluation. Study `blackjack_ai_api.py` for validated HTTP
prediction requests and startup loading. TensorFlow is imported only for training
or parity tests, not when the API starts.

The additional `conftest.py` is a small test-import setup file for the hyphenated
AI directory; it has no model logic. The lockfile pins the tested environment and
is included by `requirements.txt`, giving one installation command. Generated
`.venv` and cache directories are ignored and are not source files to maintain.

## Changes made

- Merged the useful architecture, strategy labeling, scoring, legal-state
  generation, preprocessing, splitting, conversion, and loading utilities into
  `model.py`. Removed the unused legacy experiment entry point.
- Replaced the former expanded-only training entry point with `train.py`, which
  trains the same architecture and exports a fully compatible checkpoint directly.
- Moved the working serving artifacts into `ai-service/models/` byte-for-byte,
  replacing retired duplicates. Removed the nested model directory.
- Removed optional offline simulation code/results. Classification evaluation,
  actual inference tests, and real gameplay integration tests remain available.
- Removed legacy-only evaluation fields, the separate training requirements
  entry point, and the unnecessary AI environment example. `MODEL_PATH` remains
  an optional process environment override with a documented default.
- Kept the exact serving-model training metrics, plus fingerprints of the final
  checkpoint pair. Added useful captured-prediction, metadata, finite-weight,
  load-once, evaluation-consistency, and temporary-training regressions.
- Updated README, AI learning chapter, affected defense answers, project overview,
  engine notes, API reference, development log, and team schedule. The historical
  university proposal DOCX was not edited.

There are no active imports or executable instructions for removed modules.
Prior implementations can be reviewed through Git history without maintaining
archives in the source tree. Frontend/backend application source, npm scripts,
components, and styling were not changed by this refactor.

## Model behavior preservation

Before changing files, the current serving PyTorch checkpoint was run on all
**2,190** evaluated feature states. Raw states, labels, scores, and actions were
captured in a temporary NumPy artifact. After consolidation/relocation, the same
comparison was executed using `model.make_dataset`, `normalize`, and `load_model`.

| Comparison | Actual result |
| --- | --- |
| Feature tuples and ordering | Identical, all 2,190 |
| Reference labels | Identical, all 2,190 |
| Predicted actions | Identical, all 2,190 |
| Maximum absolute pre/post score difference | **0.0** |
| Serving `.pt` bytes | Identical to the pre-refactor serving checkpoint |
| Serving `.keras` bytes | Identical to the pre-refactor serving checkpoint |
| Serving weights retrained/replaced | **No** |

The capture/comparison files were temporary verification inputs, not an additional
model implementation or permanent dataset to maintain. Representative captured
scores are retained in automated regression tests, and `evaluation.json` stores
hashes for both shipped artifacts. Those hashes are:

```text
blackjack_nn.pt
9801f1bb3c9f48205aaceb605399247d44eeb38a6cee67b7447aa809555f165e
blackjack_nn.keras
ebd37827a09752782c23677729c9fc370af991309a3d5e7672b08ba542df262e
```

The preserved architecture is 4 → 16 ReLU → 8 ReLU → 2 Softmax, 234 trainable
parameters. Input order is total/upcard/usable-Ace/count; divisors are
`[21,11,1,20]`. Index 0 is STAND; index 1 is HIT. Legal non-busting coverage is
2–20 cards. Live predictions still run real PyTorch forward propagation.

## Preserved training evidence

These are the measured results of the serving model's recorded training run,
not results invented or newly obtained by retraining during cleanup:

| Measure | Recorded value |
| --- | --- |
| Seed / epochs | 42 / 600 |
| Distinct reachable feature tuples | 2,190 |
| Train / validation / test states | 1,532 / 329 / 329 |
| Held-out agreement with reference labels | 327/329 = **99.3921%** |
| Held-out cross-entropy loss | **0.02203259** |
| All-state reference agreement | 2,186/2,190 = **99.8174%** |
| All-state reference disagreements | 4 |
| Recorded maximum TensorFlow/PyTorch score difference | **1.1920928955078125e-7** |
| TensorFlow/PyTorch actions | Identical across all states |

The held-out confusion matrix has rows truth STAND/HIT and columns predicted
STAND/HIT:

```text
216   0
  2 111
```

| Total | Upcard | Usable Ace | Cards | Network | Reference |
| --- | --- | --- | --- | --- | --- |
| 12 | 3 | 0 | 9 | STAND | HIT |
| 12 | 3 | 0 | 10 | STAND | HIT |
| 12 | 3 | 0 | 11 | STAND | HIT |
| 12 | 4 | 0 | 2 | HIT | STAND |

The API retains the network's action and discloses these disagreements. Scores
are model preferences, not probabilities of winning. Per-card held-out evidence
and tested framework versions remain in [evaluation.json](../ai-service/models/evaluation.json).
The split is stratified by label, not card count; its held-out partition contains
no 20-card tuple. Direct API and whole-domain parity tests cover that terminal
count. No model optimality, calibration, human learning benefit, or new win-rate
result is claimed.

## Executed checks after cleanup

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm test` | **30 passed, 0 failed** | Engine, isolated accounts, game-service errors/retries, actual local Socket.IO clients, privacy, turn/revision checks, disconnect policy |
| `npm run test:ai` | **40 passed, 0 failed** | Real artifacts, captured scores, strict inputs, >6 cards, metadata/finite-weight failures, load-once lifecycle, actual disagreements, complete-domain TensorFlow/PyTorch parity, report/hash consistency, real temporary training/export |
| `npm run build` | **Passed** | Vite 7.3.7 built 79 modules; output asset names/sizes match the unchanged frontend |
| `npm run test:database` | **2 passed, 0 failed** | Real Atlas/FastAPI account and persistence checks; shared-model bots and human advice; actual >6-card inference |
| `npm run test:browser` | **2 passed, 0 failed** | Existing Chrome flows for accounts, real advice/bots, profile/history, logout, mobile layout, two-user synchronized multiplayer, replay and leave |
| `python -m pip check` using the project interpreter | **Passed** | No broken requirements in the installed virtual environment |
| `python ai-service/train.py --help` using the project interpreter | **Passed** | Training CLI imports and argument setup work |
| Live `GET /health` | **HTTP 200** | Loaded final checkpoint, 234 parameters, 2–20-card range, same dataset version |
| Live `POST /predict` for soft 18, upcard 10, seven cards | **HTTP 200** | Actual HIT prediction with real model scores, reference comparison, explanation, and score warning |
| Pre/post complete-domain prediction comparison | **Passed** | Same 2,190 states/labels/actions, maximum score difference 0.0 |

There are **74 passing cases across the four automated suites**. This is a test
count, not a code-coverage percentage. The one-epoch training/export test writes
only to pytest's temporary directory; its experiment metrics do not replace the
600-epoch serving model's report. It proves the refactored training pipeline can
run and export compatible real weights without relying on removed modules.

The Python suite reports installed dependency deprecations: Starlette's httpx
TestClient compatibility and Keras/NumPy array-copy handling during export. They
are warnings, not failed checks; no warnings were hidden to claim a clean run.
Browser output may contain the existing color-environment warning.

An initial Atlas startup attempt failed with a sanitized message. The diagnostic
retry connected and initialized indexes successfully, and the real integration
suite passed without changing private configuration. Subsequent Express startup
and browser checks used that actual database connection.

The first browser run passed multiplayer but found a timing issue in the existing
single-player test: after an immediate natural Blackjack, it could inspect the
previous completed round before a new deal finished. The test now waits for that
deal's actual HTTP response and matching actionable/finished UI state. Both flows
passed on rerun. This fixes test synchronization without changing website code.

## Test isolation and unchanged website behavior

Default JavaScript account/service tests use explicitly labeled isolated storage
and, where appropriate, prediction fixtures to test turn control. Production
`server.js` always uses Atlas and does not fall back to fake data or decisions.
The separate database suite uses actual Atlas/FastAPI where applicable. Its
large-hand state fixture controls the hand but calls the actual model. Browser
flows use independent accounts and real running services, with created test
records cleaned by exact IDs.

Both intelligent features still use the same backend AI client and `/predict`
endpoint. Bots automatically apply the model's legal action. Human advice never
acts automatically. The dealer remains deterministic S17. Authentication,
registration/login, JWT validation, private records, history/statistics, up to
two bots, and real-time rooms for 2–4 humans keep their existing contracts.
An AI outage remains visible; no rule-based/random substitution was added.

Private `.env` files were not edited, printed, staged, or committed. Placeholder
configuration remains server-side. Secret/ignore checks and stale-reference/link
checks are part of final source review. The proposal DOCX is unchanged.

## Run, train, and test commands

From the repository root, for a new checkout only:

```sh
npm ci
python3.12 -m venv ai-service/.venv
source ai-service/.venv/bin/activate
python -m pip install -r ai-service/requirements.txt
```

An existing checkout only needs activation, not a new virtual environment or
reinstallation before every run. Keep the existing private backend configuration.
The complete setup instructions are in the [README](../README.md).

Start Python in one terminal:

```sh
source ai-service/.venv/bin/activate
python -m uvicorn blackjack_ai_api:app --app-dir ai-service --host 127.0.0.1 --port 8000
```

Start Express and React together from the repository root in another terminal:

```sh
npm run dev
```

Open `http://localhost:5173` using the hostname allowed in `CLIENT_ORIGIN`.
For multiplayer, use separate browser sessions for separate accounts.

```sh
npm test
npm run test:ai
npm run build
# FastAPI must be running for database/model integration:
npm run test:database
# All three services must be running for browser tests:
npm run test:browser
```

To study training without replacing the serving model:

```sh
python ai-service/train.py --epochs 600 --output /tmp/blackjack-model-experiment
```

Without `--output`, training deliberately writes `.keras`, `.pt`, and evaluation
JSON into `ai-service/models/`. Restart FastAPI when deliberately deploying new
weights. Tests and normal gameplay never modify these serving files.

## Remaining limitations

- This remains a single-server local application. Active games, rooms, locks, and
  failed-save results are in process memory and can be lost on restart; committed
  completed history persists in Atlas. No multi-server coordination was added.
- Last-socket disconnect stands the unfinished human hand immediately. There is
  no grace timer, turn timer, or idle-game expiry. Reconnecting does not reopen a
  stood hand. These existing policies are unchanged.
- No public deployment, production load test, comprehensive security audit,
  screen-reader study, or broad browser/device matrix was performed.
- Four model/reference disagreements remain. Training labels do not capture the
  full shoe composition; scores are not calibrated winning probabilities.
- The serving model was not retrained during cleanup. A fresh 600-epoch training
  reproduction was not executed as part of this refactor; the one-epoch temporary
  training/export smoke test was executed. Hardware/framework changes may affect
  future training reproducibility even with the same seed.
- The university proposal remains a historical document. Updating it for a final
  submission is separate from maintaining the current learning guides/report.

Verification servers are stopped after checks so the documented startup commands
can reuse their ports. Check Git history for the source before cleanup rather
than looking for retired experiments in the active AI directory.
