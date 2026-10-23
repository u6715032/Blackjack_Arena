# 03 — Express backend explained

Express turns a request such as `POST /api/games/single/action` into a call to a
JavaScript function. The backend is the referee: clients request actions; the
backend decides whether those actions are legal.

## Startup and middleware

`server.js` validates private configuration, connects to Atlas, waits for indexes,
and only then starts listening. `app.js` assembles the reusable application;
tests can create the same application with an explicitly isolated test repository.
Production startup always supplies the real MongoDB repository.

Middleware runs before a route handler. This app uses:

1. Helmet for response headers and CORS for the configured browser origin.
2. A small JSON body limit and cookie parsing.
3. Origin checks for state-changing requests.
4. Per-IP request limits and a tighter login/registration limit.
5. `auth.requireUser` before protected REST endpoints.
6. A final error handler that hides database connection details.

Express 5 forwards rejected async route promises to error middleware. The error
handler distinguishes safe validation errors from unknown database/server errors.
It never returns raw MongoDB driver messages, which could contain private hosts.

## Routes and controllers

`routes/index.js` contains simple inline route handlers. Each handler has the
controller role: read input, call an appropriate service, and send JSON. There
is no separate controller directory that merely forwards identical arguments.

For example, the HIT/STAND route passes only the authenticated user and submitted
action metadata to `games.singleAction`. It does not accept a client-supplied hand.

```js
await games.singleAction(String(request.user._id), request.body)
```

The game service owns rounds and rooms; the engine owns rules; the database
service owns persistence. This separation is enough for a small student project.

## Async/await

An async function can pause for network work without blocking the Node process:

```js
const recommendation = await predict(
  predictionFeatures(player.hand, game.dealerHand[0])
);
```

Other requests can arrive during that pause. Therefore `withLock` marks the
single-player table or room as busy until the operation finishes. A duplicate
action receives an understandable conflict response. Locks are simple in-memory
sets, sufficient for one Node process; they are not distributed locks.

## Authentication

Registration validates username/email/password, hashes the password with bcrypt
cost 12, and transactionally creates the user and initial statistics. Login
compares the password with the stored hash. The response sets a JWT in an
HTTP-only, SameSite=Strict cookie with an eight-hour expiry.

The JWT contains a user ID and session version, not a password. Verification
checks signature, allowed HS256 algorithm, issuer, audience, expiry, and the
current database user/version. Logout increments the user's `tokenVersion`,
invalidating every older session, clears the cookie, and disconnects their sockets.

The app verifies Socket.IO identity both on connection and before each event.
A stolen/old socket cannot bypass logout by staying connected. HTTPS and secure
cookies are required when deploying publicly. In local HTTP development the
secure-cookie option is disabled so the browser can send the cookie.

## Exercise

Call a protected route without cookies and observe HTTP 401. Then use the UI to
log in and observe the same route succeeding. Add a temporary server-side log
of the route name and user ID while debugging, then remove it. Never log the
JWT, raw password, private configuration, or entire user document.
