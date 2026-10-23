import { cookieName } from "./middleware/auth.js";

function sessionCookie(header = "") {
  return header
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
}

export function configureSockets(io, auth, games, clientOrigin) {
  const connections = new Map();
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && origin !== clientOrigin)
        throw new Error("Origin not allowed.");
      socket.data.token = sessionCookie(socket.handshake.headers.cookie);
      socket.data.user = await auth.verifyToken(socket.data.token);
      next();
    } catch {
      next(new Error("Please log in before joining a room."));
    }
  });
  games.setNotifier((code, room) => io.to(code).emit("room:update", room));
  io.on("connection", (socket) => {
    const userId = String(socket.data.user._id);
    if (!connections.has(userId)) connections.set(userId, new Set());
    connections.get(userId).add(socket.id);
    socket.join(`user:${userId}`);
    const previousRoom = games.roomView(userId);
    if (previousRoom) {
      socket.join(previousRoom.code);
      games.setConnected(userId, true).catch(() => {});
    }
    const recentEvents = [];
    function on(event, operation) {
      socket.on(event, async (data, ack) => {
        if (typeof ack !== "function") return;
        try {
          const now = Date.now();
          while (recentEvents.length && recentEvents[0] < now - 10000)
            recentEvents.shift();
          if (recentEvents.length >= 40)
            throw new Error("Too many actions. Please wait.");
          recentEvents.push(now);
          socket.data.user = await auth.verifyToken(socket.data.token);
          const result = await operation(data || {});
          ack({ ok: true, data: result });
        } catch (error) {
          ack({
            ok: false,
            error:
              error.status ||
              /turn|room|code|host|action|player|round|table|network|already|changed|wait/i.test(
                error.message,
              )
                ? error.message
                : "The action could not be completed.",
          });
        }
      });
    }
    on("room:get", () => games.roomView(userId));
    on("room:create", () => {
      const room = games.createRoom(socket.data.user);
      socket.join(room.code);
      return room;
    });
    on("room:join", (data) => {
      const room = games.joinRoom(socket.data.user, data.code);
      socket.join(room.code);
      return room;
    });
    on("room:start", () => games.startRoom(userId));
    on("game:action", (data) => games.roomAction(userId, data));
    on("game:advice", (data) => games.roomAdvice(userId, data));
    on("game:save", () => games.retryRoomSave(userId));
    on("room:leave", async () => {
      const code = await games.leaveRoom(userId);
      for (const socketId of connections.get(userId) || []) {
        const userSocket = io.sockets.sockets.get(socketId);
        userSocket?.leave(code);
        userSocket?.emit("room:update", null);
      }
      return null;
    });
    socket.on("disconnect", () => {
      connections.get(userId)?.delete(socket.id);
      if (!connections.get(userId)?.size) {
        connections.delete(userId);
        games.setConnected(userId, false).catch(() => {});
      }
    });
  });
}
