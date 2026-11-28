import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import request from "supertest";
import { io as connectSocket } from "socket.io-client";
import { createApplication } from "../src/app.js";
import { testRepository, testConfig, testShoe } from "./helpers.js";

function emit(socket, event, data = {}) {
  return new Promise((resolve, reject) =>
    socket.timeout(4000).emit(event, data, (error, response) => {
      if (error) return reject(error);
      if (!response.ok) return reject(new Error(response.error));
      resolve(response.data);
    }),
  );
}
async function waitUntil(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected socket state did not arrive.");
}

test("real Socket.IO clients: authentication, rooms, turns, hidden cards, stale moves, disconnects", async () => {
  const { app, server, io } = createApplication({
    config: testConfig,
    repository: testRepository(),
    shoeFactory: () =>
      testShoe(
        "5",
        "6",
        "7",
        "8",
        "10",
        "6",
        "7",
        "8",
        "9",
        "7",
        "2",
        "3",
        "4",
        "5",
      ),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  const identities = [];
  try {
    const unauthorized = connectSocket(url, {
      transports: ["websocket"],
      reconnection: false,
    });
    sockets.push(unauthorized);
    assert.match(
      (await once(unauthorized, "connect_error"))[0].message,
      /log in/,
    );
    for (let index = 0; index < 5; index += 1) {
      const result = await request(app)
        .post("/api/auth/register")
        .send({
          username: `SocketUser${index}`,
          email: `socket${index}@example.test`,
          password: "socket-test-password",
        })
        .expect(201);
      identities.push(result.body.user);
      const socket = connectSocket(url, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: {
          Cookie: result.headers["set-cookie"][0].split(";")[0],
          Origin: testConfig.clientOrigin,
        },
      });
      sockets.push(socket);
      await once(socket, "connect");
    }
    const [host, second, third, fourth, fifth] = sockets.slice(1);
    let room = await emit(host, "room:create");
    assert.match(room.code, /^[A-Z2-9]{6}$/);
    await assert.rejects(emit(host, "room:start"), /two/);
    await assert.rejects(
      emit(second, "room:join", { code: "XXXXXX" }),
      /not found/,
    );
    await assert.rejects(emit(second, "room:join", { code: "bad" }), /valid/);
    for (const socket of [second, third, fourth])
      room = await emit(socket, "room:join", { code: room.code });
    assert.equal(room.players.length, 4);
    await assert.rejects(emit(fifth, "room:join", { code: room.code }), /full/);
    await assert.rejects(emit(second, "room:start"), /host/);
    room = await emit(host, "room:start");
    if (room.game.status === "playing") {
      assert.deepEqual(room.game.dealer.hand[1], { hidden: true });
      assert.equal(room.game.dealer.total, null);
      assert.equal("shoe" in room.game, false);
      const activeIndex = identities.findIndex(
        (user) => user.id === room.game.currentPlayerId,
      );
      const wrong = [host, second, third, fourth][(activeIndex + 1) % 4];
      const payload = {
        action: "HIT",
        roundId: room.game.id,
        revision: room.game.revision,
      };
      await assert.rejects(emit(wrong, "game:action", payload), /turn/);
      const active = [host, second, third, fourth][activeIndex];
      const results = await Promise.allSettled([
        emit(active, "game:action", { ...payload, action: "STAND" }),
        emit(active, "game:action", { ...payload, action: "STAND" }),
      ]);
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      room = await emit(host, "room:get");
    }
    // Finish with synchronized human stands; randomized deals may already be terminal.
    while (room.game.status === "playing") {
      const index = identities.findIndex(
        (user) => user.id === room.game.currentPlayerId,
      );
      room = await emit([host, second, third, fourth][index], "game:action", {
        action: "STAND",
        roundId: room.game.id,
        revision: room.game.revision,
      });
    }
    assert.equal(room.game.saved, true);
    assert.ok(room.game.dealer.total >= 17);
    await assert.rejects(
      emit(fifth, "game:action", {
        action: "HIT",
        roundId: room.game.id,
        revision: room.game.revision,
      }),
      /not in/,
    );
    second.disconnect();
    await waitUntil(
      async () =>
        !(await emit(host, "room:get")).players.find(
          (player) => player.id === identities[1].id,
        ).connected,
    );
    room = await emit(host, "room:start");
    assert.equal(room.players.length, 3);
    const currentId = room.game.currentPlayerId;
    if (currentId) {
      const index = identities.findIndex((user) => user.id === currentId);
      sockets[index + 1].disconnect();
      const viewer = sockets
        .slice(1)
        .find((socket) => socket.connected && socket !== fifth);
      await waitUntil(async () => {
        const state = await emit(viewer, "room:get");
        return state.game.currentPlayerId !== currentId;
      });
      room = await emit(viewer, "room:get");
      assert.equal(
        room.game.players.find((player) => player.id === currentId).status,
        "disconnected",
      );
    }
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

test("all Socket.IO clients receive a confirmed turn extension and reconnecting tabs recover it", async (t) => {
  const realNow = Date.now;
  let offset = 0;
  t.mock.method(Date, "now", () => realNow() + offset);
  const { app, server, io } = createApplication({
    config: testConfig,
    repository: testRepository(),
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7", "2", "3"),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];
  const cookies = [];
  try {
    for (let index = 0; index < 2; index++) {
      const result = await request(app)
        .post("/api/auth/register")
        .send({
          username: `TimerSocket${index}`,
          email: `timer-socket${index}@example.test`,
          password: "socket-test-password",
        })
        .expect(201);
      cookies.push(result.headers["set-cookie"][0].split(";")[0]);
      const socket = connectSocket(url, {
        transports: ["websocket"],
        reconnection: false,
        extraHeaders: {
          Cookie: cookies[index],
          Origin: testConfig.clientOrigin,
        },
      });
      sockets.push(socket);
      await once(socket, "connect");
    }
    const [host, guest] = sockets;
    let room = await emit(host, "room:create");
    await emit(guest, "room:join", { code: room.code });
    room = await emit(host, "room:start");
    const deadline = room.game.turnDeadline;
    const hostUpdate = once(host, "room:update");
    const guestUpdate = once(guest, "room:update");
    offset = 15001;
    room = await emit(host, "game:action", {
      action: "HIT",
      roundId: room.game.id,
      revision: room.game.revision,
    });
    assert.equal(room.game.turnDeadline, deadline + 5000);
    assert.equal(
      (await hostUpdate)[0].game.turnDeadline,
      room.game.turnDeadline,
    );
    assert.equal(
      (await guestUpdate)[0].game.turnDeadline,
      room.game.turnDeadline,
    );
    const restored = connectSocket(url, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: { Cookie: cookies[0], Origin: testConfig.clientOrigin },
    });
    sockets.push(restored);
    await once(restored, "connect");
    assert.equal(
      (await emit(restored, "room:get")).game.turnDeadline,
      room.game.turnDeadline,
    );
  } finally {
    for (const socket of sockets) socket.disconnect();
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});
