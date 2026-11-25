# HTTP and Socket.IO contracts

The browser uses `/api` through Vite's local proxy. Express calls FastAPI using
private `AI_SERVICE_URL`. All JSON responses are allowlisted; no password hash,
token, hidden card, shoe order, or database credentials are response fields.

## REST

| Method and path | Input | Result |
| --- | --- | --- |
| GET `/api/health` | None | `{ready}` for database connection |
| GET `/api/leaderboard?page=1` | Public; 20 results per page | Rank, user ID, username and chips only |
| POST `/api/auth/register` | username, email, password | `{user}` and session cookie |
| POST `/api/auth/login` | email, password | `{user,rewardGranted,nextRewardAt}` and session cookie |
| POST `/api/auth/logout` | Session cookie | Revoke all user's sessions, clear cookie |
| GET `/api/auth/me` | Session cookie | `{user,rewardGranted,nextRewardAt}`; claims an eligible reward |
| GET `/api/profile` | Session cookie | `{user,statistics}` |
| GET `/api/statistics` | Session cookie | `{statistics}` |
| GET `/api/history` | Session cookie; optional `page=1` | `{history,pageSize:20}` |
| GET `/api/games/single` | Session cookie | `{game}` or `{game:null}` |
| GET `/api/wallet` | Session cookie | `{chips}` |
| GET `/api/leaderboard/me` | Session cookie | Current player's balance rank |
| GET `/api/wheel` | Session cookie | Cost, prizes, probabilities and theoretical RTP |
| POST `/api/wheel/spin` | `{requestId}` UUID v4 | Durable server-selected prize; same ID retries the same spin |
| POST `/api/games/single` | `{botCount:0|1|2,wager,payoutMode}` | `{game}`; mode is `standard` or `experimental` |
| POST `/api/games/single/action` | action, roundId, revision | Updated `{game}` |
| POST `/api/games/single/advice` | roundId, revision | Model recommendation |
| POST `/api/games/single/retry` | Session cookie | Retry paused bot or unsaved result |

All routes except health, login, and registration require a valid cookie.

History returns at most the authenticated user's 20 retained rounds, ordered by
`playedAt` descending and then `_id` descending. `page=1` remains accepted; other
page values return HTTP 400. There is no `page` response field or next page.
For an account with no history, the response is `{"history":[],"pageSize":20}`.
Lifetime statistics are independent of retained history; pruning does not reduce
counts or win percentage. Duplicate-save receipts are internal database records,
not history API entries.

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
revision; the prediction itself never plays a human move. In multiplayer an
already-expired deadline is enforced before advice: the server stands the player
and rejects the request. The deadline remains active while inference is awaited.

The authenticated user object includes `chips` after wallet initialization.
Login and session restoration atomically grant an eligible 10-chip reward and
return the next eligibility time as an ISO timestamp. Registration creates a
100-chip opening balance; the first subsequent login or session restoration can
claim the first daily reward. Public users contain id, username, email, createdAt. Public game snapshots contain
id, mode, revision, status, currentPlayerId, players, dealer, saved, saveError,
aiError. Multiplayer snapshots also contain `turnDeadline`: a Unix timestamp in
milliseconds for the active human's deadline, or `null` after completion. The
field is omitted for single-player games. Every participant's hand is face-up.
Dealer total is null and its second card is a placeholder until completion.
Result strings are `win`, `loss`, `push`.

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
| `room:wager` | `{amount}` | Set the authenticated player's next wager |
| `game:action` | action, roundId, revision | Updated room |
| `game:advice` | roundId, revision | Recommendation for own hand |
| `game:save` | `{}` | Room after saving retry |
| `room:leave` | `{}` | null |

Every ack is `{ok:true,data:...}` or `{ok:false,error:"..."}`. The server emits
`room:update` with the current permitted room after changes; an explicit leave
also clears that user's other tabs with `room:update: null`. A room contains
code, hostId, players (id/username/isBot/connected), game or null, and `serverTime`
(Unix milliseconds at snapshot creation). A lobby has `game: null` and no countdown.

For example, these timing fields describe 30 seconds remaining; other room/game
fields are omitted from this illustration:

```json
{"serverTime":1794800000000,"game":{"turnDeadline":1794800030000}}
```

The server owns the 30-second deadline for the whole human turn. HIT preserves it;
changing the active player starts a fresh deadline. Clients use `serverTime` to
estimate their clock offset and display the remaining time from `game.turnDeadline`.
There is no per-second socket event or client command to trigger expiry. On
timeout the server applies normal STAND with current engine revision validation,
broadcasts the updated room, and saves results if the round completes. Lobby and
completed-round waiting periods have no turn timer. Re-fetching a room does not
reset the deadline; losing the last socket still stands the hand immediately.

The host can start with 2–4 connected humans. Bots are only single-player
tablemates. For disconnect and restart policies, see learning-guide chapter 06.

## Internal FastAPI

Bind to loopback locally. Do not expose this service as a browser-facing API;
it has no independent user authentication and assumes a private network.

`GET /health` confirms the loaded model, 234 parameters, dataset version,
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

The default checkpoint is `ai-service/models/blackjack_nn.pt`. `model.py` owns
architecture, normalization, and compatibility checks; `blackjack_ai_api.py` uses
those functions without importing the offline TensorFlow training program.
