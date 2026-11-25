import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  friendshipAction,
  socialOverview,
  searchPlayers,
  readConversation,
  sendMessage,
} from "../services/social.js";
import {
  transferChips,
  createLoan,
  respondLoan,
  repayLoan,
  listLoans,
  participantLoan,
  LOAN_LIMIT,
  LOAN_DURATION_MS,
} from "../services/finance.js";

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
  const notifyMoney = (userId, otherId) => {
    notify(userId, otherId);
    io.to(`user:${userId}`).to(`user:${otherId}`).emit("wallet:update");
  };
  router.get("/loans", async (req, res) =>
    res.json({
      loans: await listLoans(req.user._id),
      limit: LOAN_LIMIT,
      durationMs: LOAN_DURATION_MS,
    }),
  );
  router.post("/transfers", async (req, res) => {
    const receipt = await transferChips(
      req.user._id,
      req.body?.recipient,
      req.body?.amount,
      req.body?.requestId,
    );
    notifyMoney(req.user._id, req.body.recipient);
    res.status(201).json({ id: String(receipt._id) });
  });
  router.post("/loans", async (req, res) => {
    const loan = await createLoan(
      req.user._id,
      req.body?.otherId,
      req.body?.direction,
      req.body?.amount,
      req.body?.requestId,
    );
    notify(req.user._id, req.body.otherId);
    res.status(201).json({ id: String(loan._id) });
  });
  router.post("/loans/:id/:action", async (req, res) => {
    const original = await participantLoan(req.user._id, req.params.id);
    if (req.params.action === "repay")
      await repayLoan(
        req.user._id,
        req.params.id,
        req.body?.amount,
        req.body?.requestId,
      );
    else await respondLoan(req.user._id, req.params.id, req.params.action);
    notifyMoney(original.borrower, original.lender);
    res.json({ ok: true });
  });
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
