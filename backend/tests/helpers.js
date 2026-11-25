// This repository is ONLY for isolated tests. Production always uses MongoDB.
export function testRepository() {
  const users = new Map();
  const histories = new Map();
  const receipts = new Set();
  const statistics = new Map();
  function historyFor(id) {
    return [...histories.values()]
      .filter((round) => round.user === id)
      .sort(
        (first, second) =>
          second.playedAt - first.playedAt || second._id - first._id,
      )
      .slice(0, 20);
  }
  return {
    isReady: () => true,
    async placeBets() {},
    async createUser(values) {
      if (
        [...users.values()].some(
          (user) =>
            user.email === values.email || user.username === values.username,
        )
      ) {
        const error = new Error("Duplicate");
        error.code = 11000;
        throw error;
      }
      const user = {
        ...values,
        _id: String(users.size + 1),
        tokenVersion: 0,
        createdAt: new Date(),
      };
      users.set(user._id, user);
      statistics.set(user._id, {
        totalGames: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        winPercentage: 0,
      });
      return user;
    },
    async findUserByEmail(email) {
      return [...users.values()].find((user) => user.email === email);
    },
    async findUserById(id) {
      return users.get(id);
    },
    async revokeSessions(id) {
      users.get(id).tokenVersion += 1;
    },
    async getStatistics(id) {
      return statistics.get(id);
    },
    async getHistory(id) {
      return historyFor(id);
    },
    async saveRound(game) {
      for (const player of game.players.filter((player) => !player.isBot)) {
        const key = `${game.id}:${player.id}`;
        if (receipts.has(key)) continue;
        receipts.add(key);
        histories.set(key, {
          _id: receipts.size,
          user: player.id,
          roundId: game.id,
          mode: game.mode,
          result: player.result,
          playedAt: game.completedAt,
        });
        const retained = new Set(
          historyFor(player.id).map((round) => round.roundId),
        );
        for (const [historyKey, round] of histories) {
          if (round.user === player.id && !retained.has(round.roundId))
            histories.delete(historyKey);
        }
        const stats = statistics.get(player.id);
        if (!stats) continue;
        stats.totalGames += 1;
        stats[{ win: "wins", loss: "losses", push: "pushes" }[player.result]] +=
          1;
        stats.winPercentage = (stats.wins / stats.totalGames) * 100;
      }
    },
  };
}

export const testConfig = {
  jwtSecret: "test-only-secret-at-least-32-characters-long",
  clientOrigin: "http://localhost:5173",
  aiServiceUrl: "http://127.0.0.1:1",
  secureCookie: false,
};
export const testHand = (...ranks) =>
  ranks.map((rank) => ({ rank: String(rank), suit: "spades" }));
export const testShoe = (...ranks) => testHand(...ranks).reverse();
