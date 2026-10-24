# Blackjack Arena

A university Senior Project: six-deck Blackjack with accounts, neural network
tablemates, a human strategy assistant, and private rooms for 2–4 human players.
There is no betting, currency, chat, leaderboard, or real-money feature.

The application uses plain JavaScript React/Vite, Express, Socket.IO, MongoDB
Atlas/Mongoose, and a local Python FastAPI/PyTorch service. Offline model training
uses real TensorFlow. No paid AI API is used.

## Quick start on this Mac

Dependencies and a Python virtual environment were installed during development.
The existing `backend/.env` was preserved. Open three terminals at the repository:

```sh
# Terminal 1: trained model service
cd ai-service
source .venv/bin/activate
python -m uvicorn blackjack_ai_api:app --host 127.0.0.1 --port 8000
```

```sh
# Terminal 2: Express (uses the private backend/.env)
npm run dev -w backend
```

```sh
# Terminal 3: React
npm run dev -w frontend
```

Open **http://localhost:5173**. Use the hostname configured in `CLIENT_ORIGIN`;
`localhost` and `127.0.0.1` are different origins. Vite listens on loopback.
Create an account, select tablemates, and deal a hand. For multiplayer, use two
different browser profiles or a normal window plus a private window so each person
has a separate login cookie. Leaving the multiplayer page disconnects its socket.

Alternatively, run Express and React together after starting Python:

```sh
npm run dev
```

If a port is already occupied, stop the old process before starting another copy.
Vite selects the backend port from the private configuration on the Node side;
no database or JWT secrets are included in frontend code.

## Setup on another computer

Install Node.js 22.12+ and Python 3.12. Use the lockfiles for reproducibility.

```sh
npm ci
python3.12 -m venv ai-service/.venv
source ai-service/.venv/bin/activate
python -m pip install -r ai-service/requirements.txt
```

There is one Python installation command for serving, training, and tests.
`requirements.txt` includes the exact versions in `requirements-lock.txt`; you
do not need to study or install that second file separately. Reuse your existing
virtual environment: create it once, then activate it in each new terminal.
On Windows activate with `ai-service\.venv\Scripts\activate`; run Python tests
with `python -m pytest ai-service/tests -q` instead of the POSIX npm helper.

Only when setting up a **new checkout without an existing private configuration**:

```sh
cp backend/.env.example backend/.env
```

Edit placeholders locally. Never copy over your existing `.env`. Required keys:

| Key | Purpose |
| --- | --- |
| `MONGODB_URI` | Atlas connection URI including a dedicated database name |
| `JWT_SECRET` | Random private signing secret, at least 32 characters |
| `PORT` | Express TCP port |
| `CLIENT_ORIGIN` | Exact browser origin, normally `http://localhost:5173` |
| `AI_SERVICE_URL` | Internal Python URL, normally `http://127.0.0.1:8000` |
| `COOKIE_SECURE` | Set `true` when serving cookies through HTTPS |

Create an Atlas database user and allow your development machine's network address
in Atlas Network Access. URL-encode special characters in a URI password. Use
Atlas, or a local MongoDB replica set: saving rounds uses multi-document
transactions and does not work with a standalone MongoDB server. The backend
checks the connection and creates required indexes before accepting requests.
It stops with a sanitized message if the database cannot be reached.

An optional `frontend/.env` can set `BACKEND_PROXY_TARGET` from its example. Do not
put secrets in frontend files or variables prefixed `VITE_`. `MODEL_PATH` is an
optional Python **process environment** setting, not an automatically loaded
Python `.env` file. It must point to a compatible checkpoint; the default is
`ai-service/models/blackjack_nn.pt`. No AI-service environment file is needed.

## Tests and build

```sh
# Engine, accounts with isolated test storage, service failures, real Socket.IO
npm test

# Actual checkpoint loading, preprocessing, input validation, TF/PT parity
npm run test:ai

# Start FastAPI first. Uses the real configured Atlas database; temporary test
# accounts and their records are removed in finally blocks.
npm run test:database

# Start all three services first. Tests real Chrome/Chromium + Atlas + FastAPI.
npm run test:browser

# Production frontend bundle: frontend/dist
npm run build
```

Browser tests use installed macOS Chrome when available. Otherwise install
Playwright's Chromium with `npx playwright install chromium`. An optional
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects another installed Chromium executable.
Screenshots and failure traces are ignored under `test-results/`.
Keep the test base URL and `CLIENT_ORIGIN` consistent if changing the frontend
port. `npm run format` formats JavaScript, JSX, and CSS for readability.

See [the verification report](docs/verification-report.md) for executed commands,
measured results, fixes, and limits. Tests with isolated storage explicitly say so;
the production server never substitutes an in-memory database for Atlas.

## Neural network

There is one final neural network implementation and one pair of trained model
files in `ai-service/models/`. During the cleanup, the serving checkpoints were
moved byte-for-byte and all 2,190 feature-state predictions were compared before
and after: actions and scores were identical. No serving weights were retrained.

Study these three Python files:

- `model.py`: reachable data, reference labels, normalization, both framework
  architectures, checkpoint loading, and verified export utilities.
- `train.py`: offline TensorFlow training and measured evaluation/export.
- `blackjack_ai_api.py`: validated FastAPI requests and actual PyTorch inference.

```sh
# With the Python environment active, from the repository root:
python ai-service/train.py --epochs 600 --output /tmp/blackjack-model-experiment
```

The example writes a separate training experiment. Omitting `--output` deliberately
replaces the three files in `ai-service/models/`; restart FastAPI to load new
weights. Training never runs during normal gameplay. The Python tests run one
training epoch in a temporary folder to check that training/export still works.
The architecture remains 4 → 16 → 8 → 2 with 234 parameters. Both intelligent
features call the same model. The dealer always uses fixed rules.

The model covers every reachable non-busting feature tuple under this
implementation's automatic stop at 21. It accepts 2–20 cards, including terminal
20-card states. At most 19 cards can require a next decision. A 21-card
non-busting hand would have to be 21 Aces; that sequence would already stop at
the eleventh Ace. No inputs are silently clipped.

Actual held-out reference-label accuracy is **99.39%** (327/329); there are four
disagreements across the 2,190 feature tuples. All TensorFlow and PyTorch actions
agree. These figures measure imitation, not a probability of winning. The API
discloses model/reference disagreements; explanations compare strategy rules,
not the internal reasoning of individual neurons.

## How the code is organized

```text
frontend/src/
  AuthContext.jsx       Shared logged-in user state
  api.js                Browser-to-Express requests
  components/           Cards, hands, controls, assistant, lobby, navbar
  pages/                Home, accounts, single player, multiplayer, profile
backend/src/
  app.js                Express/Socket.IO assembly, origin checks, errors
  server.js             Real database startup and listening
  config.js             Private server configuration
  game/engine.js        Card rules and round state transitions
  middleware/auth.js    JWT signing and verification
  models/index.js       Three Mongoose collections
  routes/index.js       REST handlers (controller role)
  services/             Database, games/rooms, internal AI requests
  sockets.js            Authenticated real-time event handlers
ai-service/
  model.py              Shared data, labels, normalization, networks, model utilities
  train.py              TensorFlow training, evaluation, verified PyTorch export
  blackjack_ai_api.py    Startup loading and validated PyTorch prediction
  models/               One .keras, one .pt, and evaluation.json
  tests/                Model, API, preprocessing, parity, and training/export tests
  requirements.txt      One installation entry point
  requirements-lock.txt Exact tested Python package versions
docs/learning-guide/    Ten teaching chapters and defense preparation
```

See [the learning guide](docs/learning-guide/01-project-overview.md),
[team plan](docs/team-learning-plan.md), and
[API reference](docs/api-reference.md). Route handlers act as simple controllers;
there is no extra controller directory duplicating them.

## Operating limits

This is a local, single-server project; it has not been publicly deployed. Active
single-player games, private rooms, and their locks live in process memory and
reset on restart. Completed saved records persist in Atlas. A failed result save
is visible and retryable while that process is running; a restart can lose it.
Do not restart while demonstrating an unfinished round.

Disconnecting a user's last socket stands their unfinished multiplayer hand,
including a future turn. Reconnecting cannot undo the stand. The host role moves
to a connected player. Disconnected seats are removed before the next round.
An empty, fully saved room is deleted. A connected player can wait indefinitely;
there is no turn timer. One stored single-player game per account has no idle
expiry; monitor memory for long-running deployments.

JWT cookies expire after eight hours. Logout revokes all that user's sessions
and disconnects their sockets. There is no email verification, password reset,
or account-editing UI. Public deployment requires HTTPS, a same-origin reverse
proxy for `/api` and `/socket.io`, secure cookies, and private AI network access.
The frontend build alone does not host Node, Python, or MongoDB.

## Technical references

The implementation was checked against official [Vite setup](https://vite.dev/guide/),
[Mongoose transactions](https://mongoosejs.com/docs/transactions.html),
[Socket.IO server documentation](https://socket.io/docs/v4/server-api/), and
[TensorFlow installation guidance](https://www.tensorflow.org/install/pip).
Exact versions actually installed are in the npm/Python lockfiles and model
evaluation JSON; documentation compatibility tables can lag package releases.
