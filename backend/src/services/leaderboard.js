import { User } from "../models/index.js";

export async function leaderboard(page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    const error = new Error("Invalid leaderboard page.");
    error.status = 400;
    throw error;
  }
  const pageSize = 20;
  const players = await User.find({ chips: { $type: "number" } })
    .sort({ chips: -1, _id: 1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .select("username chips")
    .lean();
  return {
    players: players.map((player, index) => ({
      id: String(player._id),
      username: player.username,
      chips: player.chips,
      rank: (page - 1) * pageSize + index + 1,
    })),
    page,
    pageSize,
  };
}
export async function leaderboardPosition(userId) {
  const user = await User.findById(userId).select("chips username").lean();
  if (!user || !Number.isSafeInteger(user.chips)) return null;
  const ahead = await User.countDocuments({
    $or: [
      { chips: { $gt: user.chips } },
      { chips: user.chips, _id: { $lt: user._id } },
    ],
  });
  return {
    id: String(user._id),
    username: user.username,
    chips: user.chips,
    rank: ahead + 1,
  };
}
