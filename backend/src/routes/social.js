import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  friendshipAction,
  socialOverview,
  searchPlayers,
  readConversation,
  sendMessage,
} from "../services/social.js";

export function createSocialRoutes(io, online) {
  const router = Router();
  router.use(
    rateLimit({
      windowMs: 60000,
      limit: 100,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many social requests. Please wait." },
    }),
  );
  const notify = (userId, otherId) => {
    io.to(`user:${userId}`).to(`user:${otherId}`).emit("social:update");
  };
  router.get("/", async (req, res) =>
    res.json(await socialOverview(req.user._id, online)),
  );
  router.get("/search", async (req, res) =>
    res.json({ users: await searchPlayers(req.user._id, req.query.q) }),
  );
  router.post("/friends/:otherId/:action", async (req, res) => {
    await friendshipAction(req.user._id, req.params.otherId, req.params.action);
    notify(req.user._id, req.params.otherId);
    res.json({ ok: true });
  });
  router.get("/messages/:otherId", async (req, res) => {
    const messages = await readConversation(req.user._id, req.params.otherId);
    res.json({ messages });
  });
  router.post("/messages/:otherId", async (req, res) => {
    await sendMessage(req.user._id, req.params.otherId, req.body?.text);
    notify(req.user._id, req.params.otherId);
    res.status(201).json({ ok: true });
  });
  return router;
}
