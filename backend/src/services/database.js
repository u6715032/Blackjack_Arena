import mongoose from "mongoose";
import { User, GameHistory, PlayerStatistics } from "../models/index.js";
import { calculateHandTotal } from "../game/engine.js";

mongoose.set("bufferCommands", false);

export async function connectDatabase(mongoUri) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 8000 });
  // Indexes make duplicate email and duplicate round protection effective before serving traffic.
  await User.init();
  await GameHistory.init();
  await PlayerStatistics.init();
}

export const database = {
  isReady: () => mongoose.connection.readyState === 1,
  async createUser(values) {
    return mongoose.connection.transaction(async (session) => {
      const [user] = await User.create([values], { session });
      await PlayerStatistics.create([{ user: user._id }], { session });
      return user;
    });
  },
  findUserByEmail: (email) => User.findOne({ email }).select("+passwordHash"),
  findUserById: (id) =>
    mongoose.isValidObjectId(id) ? User.findById(id) : null,
  revokeSessions: (id) =>
    User.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } }),
  getStatistics: (user) =>
    PlayerStatistics.findOne({ user }).select("-_id -__v -user"),
  getHistory: (user, page) =>
    GameHistory.find({ user })
      .sort({ playedAt: -1, _id: -1 })
      .skip((page - 1) * 20)
      .limit(20)
      .select("-__v -user")
      .lean(),
  async saveRound(game) {
    // One transaction includes every human's record and statistics. Retries cannot double-count.
    await mongoose.connection.transaction(async (session) => {
      for (const player of game.players.filter((player) => !player.isBot)) {
        const exists = await GameHistory.exists({
          user: player.id,
          roundId: game.id,
        }).session(session);
        if (exists) continue;
        await GameHistory.create(
          [
            {
              user: player.id,
              roundId: game.id,
              mode: game.mode,
              result: player.result,
              playerTotal: calculateHandTotal(player.hand),
              dealerTotal: calculateHandTotal(game.dealerHand),
              playedAt: game.completedAt,
            },
          ],
          { session },
        );
        const counter = { win: "wins", loss: "losses", push: "pushes" }[
          player.result
        ];
        const statistics = await PlayerStatistics.findOneAndUpdate(
          { user: player.id },
          { $inc: { totalGames: 1, [counter]: 1 } },
          { returnDocument: 'after', session, upsert: true },
        );
        statistics.winPercentage = Number(
          ((statistics.wins / statistics.totalGames) * 100).toFixed(2),
        );
        await statistics.save({ session });
      }
    });
  },
};
