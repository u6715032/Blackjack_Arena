import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { createAuth } from "./middleware/auth.js";
import { createRoutes } from "./routes/index.js";
import { createGameService } from "./services/games.js";
import { createAiClient } from "./services/ai.js";
import { configureSockets } from "./sockets.js";

export function createApplication({
  config,
  repository,
  predict,
  shoeFactory,
}) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    cors: { origin: config.clientOrigin, credentials: true },
    maxHttpBufferSize: 4096,
    allowRequest: (request, callback) =>
      callback(
        null,
        !request.headers.origin ||
          request.headers.origin === config.clientOrigin,
      ),
  });
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: "8kb" }));
  app.use(cookieParser());
  // SameSite cookies and explicit Origin validation protect cookie-authenticated writes from CSRF.
  app.use((request, response, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      request.headers.origin &&
      request.headers.origin !== config.clientOrigin
    ) {
      return response
        .status(403)
        .json({ error: "This website origin is not allowed." });
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please wait a moment." },
    }),
  );
  const auth = createAuth(config, repository);
  const games = createGameService({
    repository,
    predict: predict || createAiClient(config.aiServiceUrl),
    shoeFactory,
  });
  app.use("/api", createRoutes({ repository, auth, games, io }));
  app.use((request, response) =>
    response.status(404).json({ error: "Route not found." }),
  );
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error.code === 11000)
      return response
        .status(409)
        .json({ error: "That username or email is already registered." });
    if (error.type === "entity.parse.failed")
      return response
        .status(400)
        .json({ error: "Request body must be valid JSON." });
    if (error.type === "entity.too.large")
      return response.status(413).json({ error: "Request is too large." });
    const status = error.status || 503;
    // Driver errors can contain hosts and credentials. Never return or log raw database errors.
    response
      .status(status)
      .json({
        error: error.status
          ? error.message
          : "Database or server unavailable. Please retry.",
      });
  });
  configureSockets(io, auth, games, config.clientOrigin);
  return { app, server, io, games };
}
