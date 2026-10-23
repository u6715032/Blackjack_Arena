# 06 — Multiplayer explained

HTTP is useful for independent requests such as login. Multiplayer also needs
the server to tell everyone when someone else acts. Socket.IO provides that
bidirectional event connection. It is a transport, not the game referee.

## Authentication and identity

`backend/src/sockets.js` reads the same HTTP-only session cookie used by REST.
Connection middleware verifies its JWT and database session version. Each event
verifies the token again, so an expired or revoked session cannot keep acting.
The server derives `userId` from that identity, never from an event's submitted ID.
Browser origins are checked during the handshake as well.

The code tracks all socket IDs for each authenticated user. Closing one of two
tabs does not disconnect the person from the game; losing their **last** socket
does. Multiple tabs share one account and one seat.

## Room management

`services/games.js` stores rooms in a `Map`, and another map links each user to
their room. A room contains a six-character cryptographically random code,
`hostId`, participant list, and optional game. Codes are invitation locators,
not a substitute for authentication.

`createRoom` refuses a second room for the same account. `joinRoom` validates the
code, existence, capacity, and round status. A room holds at most four humans;
only the host can start, with at least two connected players. Joining a running
round is rejected. A connected member can re-fetch their own current room.

Active rooms live in memory for this one-process version. Restarting Node loses
them. Only completed saved outcomes are persistent. Horizontal scaling would
need shared room ownership/state and coordinated locking; it is outside scope.

## Events

| Client event | Server action |
| --- | --- |
| `room:create` | Create a private waiting room |
| `room:join` | Join using `code` |
| `room:get` | Return this user's current room |
| `room:start` | Host starts a round or next round |
| `game:action` | Validate round/revision/turn; process HIT or STAND |
| `game:advice` | Return model recommendation for the active human |
| `game:save` | Retry saving a completed round |
| `room:leave` | Stand unfinished hand and leave the room |

Every request uses an acknowledgement envelope:

```js
{ ok: true, data: room }
// or
{ ok: false, error: 'It is not your turn.' }
```

The server broadcasts `room:update` to the room after permitted changes. The
frontend replaces its current snapshot. It does not independently calculate
what another player drew. Advice is private to the requesting socket's ack;
the shared table update contains public face-up player hands.

## Concurrency and privacy

The service rejects an overlapping mutation while a room operation is awaiting
AI or database work. Every move also carries `roundId` and `revision`; a delayed
move from an earlier state is rejected. The engine checks current player ID.
These checks handle duplicate clicks, simultaneous participants, and old packets.

`publicGame` hides the dealer's second card and total until completion and never
includes the shoe. It is used for both REST and socket responses. Returning the
whole internal room/game would be a privacy bug even if React did not draw the
secret fields: users can inspect network traffic.

## Disconnect policy

When a person's last socket closes, their unfinished hand stands immediately.
This also applies if their turn has not started. The engine can move past that
hand when appropriate. If needed, dealer resolution and saving run normally.
Their seat is marked disconnected; reconnecting marks it connected but does not
undo the stand. There is no grace timer or automatic HIT decision.

The host role transfers to a connected participant. Before the next round,
disconnected seats are removed. If everybody disconnects and results are saved,
the room is deleted. If saving fails, the room stays available for recovery while
the Node process remains alive. An explicit leave that would discard a just-failed
save is rejected with a retry message. A connected player has no turn deadline.

Navigating away from the multiplayer page closes that page's socket; tell users
to stay on the table during a round. The socket layer retries connection-status
updates that arrive during a short locked operation, using the latest status.

## Exercise

Open two independent browser sessions and join one room. Try to act in the wrong
session, then close the active session. Explain why the other player's state
changes without refreshing. Repeat using two tabs of the same account to see why
the server counts connections per user rather than treating each tab as a player.
