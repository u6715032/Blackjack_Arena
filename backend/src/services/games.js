import { randomInt } from "node:crypto";
import {
  createRound,
  applyAction,
  processHit,
  processStand,
  publicGame,
  predictionFeatures,
  determineLegalActions,
  standDisconnectedPlayer,
} from "../game/engine.js";

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

export function createGameService({ repository, predict, shoeFactory }) {
  const singleGames = new Map();
  const rooms = new Map();
  const userRooms = new Map();
  const busy = new Set();
  const connectionStatus = new Map();
  let notify = () => {};

  async function withLock(key, operation) {
    if (busy.has(key))
      fail("An action is already being processed. Try again.", 409);
    busy.add(key);
    try {
      return await operation();
    } finally {
      busy.delete(key);
    }
  }
  async function saveFinishedRound(game) {
    if (game.status !== "complete" || game.saved) return;
    try {
      await repository.saveRound(game);
      game.saved = true;
      game.saveError = null;
    } catch {
      game.saveError =
        "Result not saved yet. Retry saving before starting another round.";
    }
  }
  async function runBotsAndSave(game) {
    game.aiError = null;
    while (game.status === "playing") {
      const player = game.players[game.currentPlayerIndex];
      if (!player.isBot) break;
      try {
        const recommendation = await predict(
          predictionFeatures(player.hand, game.dealerHand[0]),
        );
        if (recommendation.action === "HIT") processHit(game, player.id);
        else if (recommendation.action === "STAND")
          processStand(game, player.id);
        else throw new Error("The model returned an unsupported action.");
      } catch {
        game.aiError =
          "Bot paused: neural network unavailable. Retry AI to continue.";
        break;
      }
    }
    await saveFinishedRound(game);
  }
  function userParticipant(user) {
    return { id: String(user._id), username: user.username, isBot: false };
  }
  function requireSingle(userId) {
    const game = singleGames.get(userId);
    if (!game) fail("Start a single-player round first.", 404);
    return game;
  }
  function requireRoom(userId) {
    const room = rooms.get(userRooms.get(userId));
    if (!room) fail("You are not in a room.", 404);
    return room;
  }
  function roomView(room) {
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.players.map((player) => ({ ...player })),
      game: publicGame(room.game),
    };
  }
  function broadcast(room) {
    notify(room.code, roomView(room));
  }
  function ensurePreviousFinished(game) {
    if (game && game.status !== "complete")
      fail("Finish the current round first.", 409);
    if (game && !game.saved)
      fail("Save the completed round before starting another.", 409);
  }
  function validateAction(data) {
    if (
      !data ||
      !["HIT", "STAND"].includes(data.action) ||
      typeof data.roundId !== "string" ||
      !Number.isInteger(data.revision)
    )
      fail("Provide an action, roundId, and revision.");
  }
  async function advice(game, userId, data) {
    if (!data || data.roundId !== game.id || data.revision !== game.revision)
      fail("The table changed. Request fresh advice.", 409);
    if (!determineLegalActions(game, userId).length)
      fail("Advice is available on your active turn only.", 409);
    const player = game.players.find((player) => player.id === userId);
    const prediction = await predict(
      predictionFeatures(player.hand, game.dealerHand[0]),
    );
    return { ...prediction, roundId: game.id, revision: game.revision };
  }

  return {
    setNotifier(callback) {
      notify = callback;
    },
    singleView: (userId) => publicGame(singleGames.get(userId)),
    async startSingle(user, botCount) {
      const userId = String(user._id);
      return withLock(userId, async () => {
        if (!Number.isInteger(botCount) || botCount < 0 || botCount > 2)
          fail("Choose 0, 1, or 2 bots.");
        if (userRooms.has(userId))
          fail("Leave your multiplayer room first.", 409);
        ensurePreviousFinished(singleGames.get(userId));
        const players = [userParticipant(user)];
        for (let index = 1; index <= botCount; index += 1)
          players.push({
            id: `bot-${index}`,
            username: `Neural Bot ${index}`,
            isBot: true,
          });
        const game = createRound(players, "single", shoeFactory?.());
        singleGames.set(userId, game);
        await runBotsAndSave(game);
        return publicGame(game);
      });
    },
    async singleAction(userId, data) {
      return withLock(userId, async () => {
        validateAction(data);
        const game = requireSingle(userId);
        try {
          applyAction(game, userId, data.action, data.roundId, data.revision);
        } catch (error) {
          fail(error.message, 409);
        }
        await runBotsAndSave(game);
        return publicGame(game);
      });
    },
    singleAdvice: (userId, data) =>
      withLock(userId, () => advice(requireSingle(userId), userId, data)),
    async retrySingle(userId) {
      return withLock(userId, async () => {
        const game = requireSingle(userId);
        await runBotsAndSave(game);
        return publicGame(game);
      });
    },
    createRoom(user) {
      const userId = String(user._id);
      if (userRooms.has(userId))
        fail("You already have a room. Reopen it from Multiplayer.", 409);
      ensurePreviousFinished(singleGames.get(userId));
      let code;
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      do {
        code = Array.from(
          { length: 6 },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
      } while (rooms.has(code));
      const room = {
        code,
        hostId: userId,
        players: [{ ...userParticipant(user), connected: true }],
        game: null,
      };
      rooms.set(code, room);
      userRooms.set(userId, code);
      return roomView(room);
    },
    joinRoom(user, code) {
      const userId = String(user._id);
      if (typeof code !== "string" || !/^[A-Z2-9]{6}$/.test(code))
        fail("Enter a valid six-character room code.");
      const room = rooms.get(code);
      if (!room) fail("Room not found.", 404);
      if (userRooms.get(userId) === code) return roomView(room);
      if (userRooms.has(userId)) fail("Leave your current room first.", 409);
      ensurePreviousFinished(singleGames.get(userId));
      if (busy.has(code)) fail("Room is updating. Try again.", 409);
      if (room.game?.status === "playing")
        fail("This room is already playing.", 409);
      if (room.players.length >= 4) fail("This room is full.", 409);
      room.players.push({ ...userParticipant(user), connected: true });
      userRooms.set(userId, code);
      broadcast(room);
      return roomView(room);
    },
    roomView(userId) {
      return userRooms.has(userId) ? roomView(requireRoom(userId)) : null;
    },
    async startRoom(userId) {
      const room = requireRoom(userId);
      return withLock(room.code, async () => {
        if (room.hostId !== userId)
          fail("Only the host can start a round.", 403);
        ensurePreviousFinished(room.game);
        const connected = room.players.filter((player) => player.connected);
        if (connected.length < 2)
          fail("At least two connected players are required.");
        for (const player of room.players.filter((player) => !player.connected))
          userRooms.delete(player.id);
        room.players = connected;
        room.game = createRound(connected, "multi", shoeFactory?.());
        await saveFinishedRound(room.game);
        broadcast(room);
        return roomView(room);
      });
    },
    async roomAction(userId, data) {
      const room = requireRoom(userId);
      return withLock(room.code, async () => {
        validateAction(data);
        if (!room.game) fail("The round has not started.");
        try {
          applyAction(
            room.game,
            userId,
            data.action,
            data.roundId,
            data.revision,
          );
        } catch (error) {
          fail(error.message, 409);
        }
        await saveFinishedRound(room.game);
        broadcast(room);
        return roomView(room);
      });
    },
    roomAdvice(userId, data) {
      const room = requireRoom(userId);
      return withLock(room.code, () => {
        if (!room.game) fail("The round has not started.");
        return advice(room.game, userId, data);
      });
    },
    async retryRoomSave(userId) {
      const room = requireRoom(userId);
      return withLock(room.code, async () => {
        if (room.game) await saveFinishedRound(room.game);
        broadcast(room);
        return roomView(room);
      });
    },
    async leaveRoom(userId) {
      const room = requireRoom(userId);
      return withLock(room.code, async () => {
        standDisconnectedPlayer(room.game, userId);
        await (room.game ? saveFinishedRound(room.game) : Promise.resolve());
        if (room.game?.status === "complete" && !room.game.saved) {
          broadcast(room);
          fail("Save the completed round before leaving the room.", 409);
        }
        room.players = room.players.filter((player) => player.id !== userId);
        userRooms.delete(userId);
        if (!room.players.length) rooms.delete(room.code);
        else {
          if (room.hostId === userId)
            room.hostId =
              room.players.find((player) => player.connected)?.id ??
              room.players[0].id;
          broadcast(room);
        }
        connectionStatus.delete(userId);
        return room.code;
      });
    },
    async setConnected(userId, connected) {
      if (!userRooms.has(userId)) return;
      connectionStatus.set(userId, connected);
      const room = requireRoom(userId);
      // A disconnect during an awaited save/advice is retried once the short operation ends.
      if (busy.has(room.code)) {
        setTimeout(
          () =>
            this.setConnected(userId, connectionStatus.get(userId)).catch(
              () => {},
            ),
          100,
        ).unref();
        return;
      }
      return withLock(room.code, async () => {
        const player = room.players.find((player) => player.id === userId);
        if (!player) return;
        player.connected = connected;
        if (!connected) standDisconnectedPlayer(room.game, userId);
        if (room.hostId === userId && !connected)
          room.hostId =
            room.players.find((player) => player.connected)?.id ?? userId;
        if (room.game) await saveFinishedRound(room.game);
        if (
          room.players.every((player) => !player.connected) &&
          (!room.game || room.game.saved)
        ) {
          for (const player of room.players) {
            userRooms.delete(player.id);
            connectionStatus.delete(player.id);
          }
          rooms.delete(room.code);
        } else broadcast(room);
      });
    },
  };
}
