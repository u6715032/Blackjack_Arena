import mongoose from "mongoose";
import { User, Loan } from "../models/index.js";

function validSort(sort) {
  if (!["balance", "net"].includes(sort)) {
    const error = new Error("Invalid leaderboard sort.");
    error.status = 400;
    throw error;
  }
}
function debtStages() {
  return [
    {
      $lookup: {
        from: Loan.collection.name,
        let: { playerId: "$_id" },
        pipeline: [
          {
            $match: {
              status: { $in: ["accepted", "overdue"] },
              $expr: { $eq: ["$borrower", "$$playerId"] },
            },
          },
          { $group: { _id: null, total: { $sum: "$outstanding" } } },
        ],
        as: "debt",
      },
    },
    {
      $set: {
        netChips: {
          $subtract: [
            "$chips",
            { $ifNull: [{ $arrayElemAt: ["$debt.total", 0] }, 0] },
          ],
        },
      },
    },
    { $project: { username: 1, chips: 1, netChips: 1 } },
  ];
}
export async function leaderboard(page = 1, sort = "balance") {
  validSort(sort);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
    const error = new Error("Invalid leaderboard page.");
    error.status = 400;
    throw error;
  }
  const pageSize = 20;
  const paging = [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }];
  const order =
    sort === "net" ? { netChips: -1, _id: 1 } : { chips: -1, _id: 1 };
  const players = await User.aggregate([
    { $match: { chips: { $type: "number" } } },
    ...(sort === "balance"
      ? [{ $sort: order }, ...paging, ...debtStages()]
      : [...debtStages(), { $sort: order }, ...paging]),
  ]);
  return {
    players: players.map((player, index) => ({
      id: String(player._id),
      username: player.username,
      chips: player.chips,
      netChips: player.netChips,
      rank: (page - 1) * pageSize + index + 1,
    })),
    page,
    pageSize,
    sort,
  };
}
export async function leaderboardPosition(userId, sort = "balance") {
  validSort(sort);
  const id = new mongoose.Types.ObjectId(userId);
  const [user] = await User.aggregate([
    { $match: { _id: id, chips: { $type: "number" } } },
    ...debtStages(),
  ]);
  if (!user) return null;
  const field = sort === "net" ? "netChips" : "chips";
  const match = {
    $or: [
      { [field]: { $gt: user[field] } },
      { [field]: user[field], _id: { $lt: id } },
    ],
  };
  let ahead;
  if (sort === "balance") ahead = await User.countDocuments(match);
  else {
    const counts = await User.aggregate([
      { $match: { chips: { $type: "number" } } },
      ...debtStages(),
      { $match: match },
      { $count: "value" },
    ]);
    ahead = counts[0]?.value || 0;
  }
  return {
    id: String(id),
    username: user.username,
    chips: user.chips,
    netChips: user.netChips,
    rank: ahead + 1,
  };
}
