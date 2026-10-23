# HTTP and Socket.IO contracts

The browser uses `/api` through Vite's local proxy. Express calls FastAPI using
private `AI_SERVICE_URL`. All JSON responses are allowlisted; no password hash,
token, hidden card, shoe order, or database credentials are response fields.

## REST

| Method and path | Input | Result |
| --- | --- | --- |
| GET `/api/health` | None | `{ready}` for database connection |
| POST `/api/auth/register` | username, email, password | `{user}` and session cookie |
| POST `/api/auth/login` | email, password | `{user}` and session cookie |
| POST `/api/auth/logout` | Session cookie | Revoke all user's sessions, clear cookie |
| GET `/api/auth/me` | Session cookie | `{user}` |
| GET `/api/profile` | Session cookie | `{user,statistics}` |
| GET `/api/statistics` | Session cookie | `{statistics}` |
| GET `/api/history?page=1` | Session cookie | `{history,page,pageSize:20}` |
| GET `/api/games/single` | Session cookie | `{game}` or `{game:null}` |
| POST `/api/games/single` | `{botCount:0|1|2}` | `{game}` |
| POST `/api/games/single/action` | action, roundId, revision | Updated `{game}` |
| POST `/api/games/single/advice` | roundId, revision | Model recommendation |
| POST `/api/games/single/retry` | Session cookie | Retry paused bot or unsaved result |

All routes except health, login, and registration require a valid cookie.
Errors use `{error: "Understandable message"}`. Typical statuses: 400 invalid
input, 401 missing/invalid session, 403 forbidden origin/host, 404 missing resource,
409 stale action/conflict, 413 body too large, 429 request limit, 503 unavailable
AI/database/server. A game action can return 200 with `game.aiError` or
`game.saveError` when the human's legal move succeeded but later bot/persistence
work paused. Read these fields instead of assuming all later work succeeded.

Input example for an action, using IDs/revisions from the current snapshot:

```json
{"action":"HIT","roundId":"current-round-uuid","revision":0}
```

The backend ignores client-invented hand features. Advice is allowed only for the
active requesting human. Advice responses include their matching round ID and
revision and do not change the game.

Public users contain id, username, email, createdAt. Public game snapshots contain
id, mode, revision, status, currentPlayerId, players, dealer, saved, saveError,
aiError. Every participant's hand is face-up. Dealer total is null and its second
card is a placeholder until completion. Result strings are `win`, `loss`, `push`.

## Socket.IO

Handshake uses the session cookie with credentials enabled; identity is rechecked
before every event. Origin must match the configured browser origin when present.
One account may have several sockets but only one seat. Events are limited per
socket, and room mutations use the same authoritative engine as single player.

| Event | Payload | Acknowledgement data |
| --- | --- | --- |
| `room:create` | `{}` | New room |
| `room:join` | `{code:"ABC234"}` | Joined room |
| `room:get` | `{}` | Own room or null |
| `room:start` | `{}` | Room with new round (host only) |
| `game:action` | action, roundId, revision | Updated room |
| `game:advice` | roundId, revision | Recommendation for own hand |
| `game:save` | `{}` | Room after saving retry |
| `room:leave` | `{}` | null |

Every ack is `{ok:true,data:...}` or `{ok:false,error:"..."}`. The server emits
`room:update` with the current permitted room after changes; an explicit leave
also clears that user's other tabs with `room:update: null`. A room contains
code, hostId, players (id/username/isBot/connected), and game or null.

The host can start with 2–4 connected humans. Bots are only single-player
tablemates. For disconnect and restart policies, see learning-guide chapter 06.

## Internal FastAPI

Bind to loopback locally. Do not expose this service as a browser-facing API;
it has no independent user authentication and assumes a private network.

`GET /health` confirms loaded expanded model, 234 parameters, dataset version,
and supported 2–20-card range. Missing/incompatible weights prevent startup.

`POST /predict` accepts exactly four strict integer fields:

```json
{"total":16,"dealer":10,"soft":0,"cards":2}
```

The API checks numeric bounds and membership in reachable legal feature states.
It rejects strings, booleans, extra fields, impossible soft hands, and unreachable
count/total combinations with 422. Scores come from an actual PyTorch forward pass.

Response fields: `action` (`HIT`/`STAND`), `scores.hit`, `scores.stand`,
`reference_action`, `agrees_with_reference`, `explanation`, and `warning`.
Softmax scores are model preferences, not win probabilities. Explanations compare
reference strategy; they are not neural interpretability evidence. The saved
checkpoint, feature order/scales, labels, and architecture must all match.
