// This repository is ONLY for isolated tests. Production always uses MongoDB.
export function testRepository() {
  const users = new Map();
  const histories = new Map();
  const statistics = new Map();
  return {
    isReady: () => true,
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
    async getHistory(id, page) {
      return [...histories.values()]
        .filter((round) => round.user === id)
        .slice((page - 1) * 20, page * 20);
    },
    async saveRound(game) {
      for (const player of game.players.filter((player) => !player.isBot)) {
        const key = `${game.id}:${player.id}`;
        if (histories.has(key)) continue;
        histories.set(key, {
          user: player.id,
          roundId: game.id,
          result: player.result,
        });
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
