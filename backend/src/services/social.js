import mongoose from "mongoose";
import {
  User,
  Friendship,
  Block,
  Message,
  Maintenance,
} from "../models/index.js";

const WEEK = 7 * 24 * 60 * 60 * 1000;
function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function pair(userId, otherId) {
  if (
    !mongoose.isValidObjectId(otherId) ||
    !mongoose.isValidObjectId(userId) ||
    String(userId) === String(otherId)
  )
    fail("Choose another valid player.");
  const [first, second] = [String(userId), String(otherId)].sort();
  return { first, second, conversation: `${first}:${second}` };
}
async function lockPair(first, second, session) {
  for (const id of [first, second]) {
    const result = await User.updateOne(
      { _id: id },
      { $inc: { socialVersion: 1 } },
      { session },
    );
    if (!result.matchedCount) fail("Player not found.", 404);
  }
}
async function ensureUnblocked(first, second, session) {
  if (
    await Block.exists({
      $or: [
        { blocker: first, blocked: second },
        { blocker: second, blocked: first },
      ],
    }).session(session)
  )
    fail("This interaction is unavailable.", 403);
}
async function requireFriends(first, second, session) {
  await ensureUnblocked(first, second, session);
  if (
    !(await Friendship.exists({ first, second, status: "accepted" }).session(
      session,
    ))
  )
    fail("Only accepted friends can use this conversation.", 403);
}
export async function friendshipAction(userId, otherId, action) {
  const { first, second } = pair(userId, otherId);
  await mongoose.connection.transaction(async (session) => {
    await lockPair(first, second, session);
    if (action === "block") {
      await Block.updateOne(
        { blocker: userId, blocked: otherId },
        { $setOnInsert: { blocker: userId, blocked: otherId } },
        { upsert: true, session },
      );
      await Friendship.deleteOne({ first, second }, { session });
      return;
    }
    if (action === "unblock") {
      await Block.deleteOne({ blocker: userId, blocked: otherId }, { session });
      return;
    }
    await ensureUnblocked(first, second, session);
    const relation = await Friendship.findOne({ first, second }).session(
      session,
    );
    if (action === "request") {
      if (relation) fail("A friendship or request already exists.", 409);
      await Friendship.create(
        [{ first, second, requestedBy: userId, status: "pending" }],
        { session },
      );
    } else if (action === "accept" || action === "decline") {
      if (
        !relation ||
        relation.status !== "pending" ||
        String(relation.requestedBy) === String(userId)
      )
        fail("No incoming request to respond to.", 409);
      if (action === "accept") {
        relation.status = "accepted";
        await relation.save({ session });
      } else await relation.deleteOne({ session });
    } else if (action === "cancel") {
      if (
        !relation ||
        relation.status !== "pending" ||
        String(relation.requestedBy) !== String(userId)
      )
        fail("No outgoing request to cancel.", 409);
      await relation.deleteOne({ session });
    } else if (action === "remove") {
      if (!relation || relation.status !== "accepted")
        fail("You are not friends.", 409);
      await relation.deleteOne({ session });
    } else fail("Unknown friendship action.");
  });
}

export async function searchPlayers(userId, query) {
  if (typeof query !== "string" || !/^[A-Za-z0-9_]{2,24}$/.test(query))
    fail("Search using 2–24 letters, numbers or underscores.");
  const blocks = await Block.find({
    $or: [{ blocker: userId }, { blocked: userId }],
  }).lean();
  const excluded = blocks.map((block) =>
    String(block.blocker) === String(userId) ? block.blocked : block.blocker,
  );
  const users = await User.find({
    _id: { $nin: [userId, ...excluded] },
    username: { $regex: query, $options: "i" },
  })
    .select("username")
    .limit(20)
    .lean();
  return users.map((user) => ({
    id: String(user._id),
    username: user.username,
  }));
}
export async function socialOverview(userId, online) {
  const relationships = await Friendship.find({
    $or: [{ first: userId }, { second: userId }],
  })
    .populate("first", "username")
    .populate("second", "username")
    .lean();
  const unread = await Message.aggregate([
    {
      $match: {
        recipient: new mongoose.Types.ObjectId(userId),
        readAt: null,
        expiresAt: { $gt: new Date() },
      },
    },
    { $group: { _id: "$sender", count: { $sum: 1 } } },
  ]);
  const counts = new Map(unread.map((item) => [String(item._id), item.count]));
  const ownBlocks = await Block.find({ blocker: userId })
    .populate("blocked", "username")
    .lean();
  const output = {
    friends: [],
    incoming: [],
    outgoing: [],
    blocked: ownBlocks
      .filter((entry) => entry.blocked)
      .map((entry) => ({
        id: String(entry.blocked._id),
        username: entry.blocked.username,
      })),
  };
  for (const relation of relationships) {
    const other =
      String(relation.first?._id) === String(userId)
        ? relation.second
        : relation.first;
    if (!other) continue;
    const id = String(other._id);
    const value = {
      id,
      username: other.username,
      online: online(id),
      unread: counts.get(id) || 0,
    };
    const group =
      relation.status === "accepted"
        ? "friends"
        : String(relation.requestedBy) === String(userId)
          ? "outgoing"
          : "incoming";
    output[group].push(value);
  }
  return output;
}
export async function readConversation(userId, otherId) {
  const { first, second, conversation } = pair(userId, otherId);
  return mongoose.connection.transaction(async (session) => {
    await lockPair(first, second, session);
    await requireFriends(first, second, session);
    const now = new Date();
    await Message.updateMany(
      {
        conversation,
        recipient: userId,
        readAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { readAt: now } },
      { session },
    );
    const messages = await Message.find({
      conversation,
      expiresAt: { $gt: now },
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(20)
      .session(session)
      .lean();
    return messages
      .reverse()
      .map(({ _id, sender, text, createdAt }) => ({
        id: String(_id),
        sender: String(sender),
        text,
        createdAt,
      }));
  });
}
export async function sendMessage(userId, otherId, text) {
  const { first, second, conversation } = pair(userId, otherId);
  if (typeof text !== "string" || !text.trim() || text.length > 1000)
    fail("Message must contain 1–1000 characters.");
  const now = new Date();
  await mongoose.connection.transaction(async (session) => {
    await Maintenance.updateOne(
      { key: "chat" },
      {
        $inc: { version: 1 },
        $setOnInsert: { nextChatCleanupAt: new Date(now.getTime() + WEEK) },
      },
      { upsert: true, session },
    );
    await lockPair(first, second, session);
    await requireFriends(first, second, session);
    await Message.create(
      [
        {
          conversation,
          sender: userId,
          recipient: otherId,
          text: text.trim(),
          expiresAt: new Date(now.getTime() + WEEK),
        },
      ],
      { session },
    );
    const excess = await Message.find({ conversation })
      .sort({ createdAt: -1, _id: -1 })
      .skip(20)
      .select("_id")
      .session(session)
      .lean();
    if (excess.length)
      await Message.deleteMany(
        { _id: { $in: excess.map((item) => item._id) } },
        { session },
      );
  });
}
export async function cleanupMessages(now = new Date()) {
  return mongoose.connection.transaction(async (session) => {
    const maintenance = await Maintenance.findOneAndUpdate(
      { key: "chat" },
      {
        $inc: { version: 1 },
        $setOnInsert: { nextChatCleanupAt: new Date(now.getTime() + WEEK) },
      },
      { upsert: true, session, returnDocument: "after" },
    );
    const weekly = maintenance.nextChatCleanupAt <= now;
    const result = await Message.deleteMany(
      weekly ? { createdAt: { $lte: now } } : { expiresAt: { $lte: now } },
      { session },
    );
    if (weekly) {
      maintenance.nextChatCleanupAt = new Date(now.getTime() + WEEK);
      await maintenance.save({ session });
    }
    return result.deletedCount;
  });
}
