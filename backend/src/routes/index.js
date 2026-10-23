import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { publicUser } from "../middleware/auth.js";

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
function readCredentials(body, registering) {
  if (
    !body ||
    typeof body.email !== "string" ||
    typeof body.password !== "string"
  )
    badRequest("Enter your email and password.");
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    badRequest("Enter a valid email address.");
  if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72)
    badRequest(
      "Password must contain at least 10 characters and at most 72 UTF-8 bytes.",
    );
  if (
    registering &&
    (typeof body.username !== "string" ||
      !/^[A-Za-z0-9_]{3,24}$/.test(body.username))
  ) {
    badRequest("Username must be 3–24 letters, numbers, or underscores.");
  }
  return { email, password, username: body.username };
}

export function createRoutes({ repository, auth, games, io }) {
  const router = Router();
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please try again later." },
  });
  router.get("/health", (request, response) =>
    response
      .status(repository.isReady() ? 200 : 503)
      .json({ ready: repository.isReady() }),
  );
  router.post("/auth/register", loginLimit, async (request, response) => {
    const values = readCredentials(request.body, true);
    const passwordHash = await bcrypt.hash(values.password, 12);
    const user = await repository.createUser({
      username: values.username,
      email: values.email,
      passwordHash,
    });
    auth.signIn(response, user);
    response.status(201).json({ user: publicUser(user) });
  });
  router.post("/auth/login", loginLimit, async (request, response) => {
    const values = readCredentials(request.body, false);
    const user = await repository.findUserByEmail(values.email);
    // A dummy hash keeps the expensive comparison even when the email does not exist.
    const valid = await bcrypt.compare(
      values.password,
      user?.passwordHash ||
        "$2b$12$kYdXFlMw3kBPLlI9TiGv2.5dtQFZVas72bmxkmuWiD0J4vjmEjn5G",
    );
    if (!user || !valid)
      return response
        .status(401)
        .json({ error: "Email or password is incorrect." });
    auth.signIn(response, user);
    response.json({ user: publicUser(user) });
  });
  router.use(auth.requireUser);
  router.post("/auth/logout", async (request, response) => {
    await repository.revokeSessions(String(request.user._id));
    io?.in(`user:${request.user._id}`).disconnectSockets(true);
    auth.clear(response);
    response.json({ message: "Logged out from all devices." });
  });
  router.get("/auth/me", (request, response) =>
    response.json({ user: publicUser(request.user) }),
  );
  router.get("/profile", async (request, response) =>
    response.json({
      user: publicUser(request.user),
      statistics: await repository.getStatistics(String(request.user._id)),
    }),
  );
  router.get("/statistics", async (request, response) =>
    response.json({
      statistics: await repository.getStatistics(String(request.user._id)),
    }),
  );
  router.get("/history", async (request, response) => {
    const page = Number(request.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000)
      badRequest("Page must be a positive integer up to 10000.");
    response.json({
      history: await repository.getHistory(String(request.user._id), page),
      page,
      pageSize: 20,
    });
  });
  router.get("/games/single", (request, response) =>
    response.json({ game: games.singleView(String(request.user._id)) }),
  );
  router.post("/games/single", async (request, response) =>
    response
      .status(201)
      .json({
        game: await games.startSingle(request.user, request.body?.botCount),
      }),
  );
  router.post("/games/single/action", async (request, response) =>
    response.json({
      game: await games.singleAction(String(request.user._id), request.body),
    }),
  );
  router.post("/games/single/advice", async (request, response) =>
    response.json(
      await games.singleAdvice(String(request.user._id), request.body),
    ),
  );
  router.post("/games/single/retry", async (request, response) =>
    response.json({ game: await games.retrySingle(String(request.user._id)) }),
  );
  return router;
}
