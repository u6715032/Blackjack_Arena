import test from "node:test";
import assert from "node:assert/strict";
import { createGameService } from "../src/services/games.js";
import { testRepository, testShoe } from "./helpers.js";

const host = { _id: "host", username: "Host" };
const guest = { _id: "guest", username: "Guest" };
const startTime = 1700000000000;
const flush = () => new Promise(setImmediate);
const payload = (game, action = "STAND") => ({
  action,
  roundId: game.id,
  revision: game.revision,
});

function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: startTime });
  const repository = testRepository();
  const service = createGameService({
    repository,
    predict: async () => ({ action: "STAND" }),
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7", "2", "3"),
    ...options,
  });
  const updates = [];
  service.setNotifier((code, room) => updates.push(room));
  const room = service.createRoom(host);
  service.joinRoom(guest, room.code);
  return { service, repository, updates };
}

test("multiplayer deadlines start only on a turn, survive HIT and views, and advance freshly", async (t) => {
  const { service } = setup(t);
  assert.equal(service.roomView(host._id).game, null);
  t.mock.timers.tick(60000);
  let { game } = await service.startRoom(host._id);
  const deadline = Date.now() + 30000;
  assert.equal(game.turnDeadline, deadline);
  t.mock.timers.tick(10000);
  game = (await service.roomAction(host._id, payload(game, "HIT"))).game;
  assert.equal(game.currentPlayerId, host._id);
  assert.equal(game.turnDeadline, deadline);
  await service.setConnected(guest._id, true);
  assert.equal(service.roomView(guest._id).game.turnDeadline, deadline);
  assert.equal(service.roomView(host._id).game.turnDeadline, deadline);
  t.mock.timers.tick(20000);
  await flush();
  game = service.roomView(host._id).game;
  assert.equal(game.players[0].status, "stood");
  assert.equal(game.currentPlayerId, guest._id);
  assert.equal(game.turnDeadline, Date.now() + 30000);
  t.mock.timers.tick(30000);
  await flush();
  game = service.roomView(host._id).game;
  assert.equal(game.status, "complete");
  assert.equal(game.turnDeadline, null);
  assert.equal(game.saved, true);
});

for (const [remaining, extension] of [
  [20000, 0],
  [16000, 0],
  [15000, 5000],
  [10000, 5000],
  [5000, 5000],
  [1000, 5000],
  [1, 5000],
]) {
  test(`HIT with ${remaining}ms remaining adds ${extension}ms`, async (t) => {
    const { service, updates } = setup(t);
    let { game } = await service.startRoom(host._id);
    const deadline = game.turnDeadline;
    t.mock.timers.tick(30000 - remaining);
    game = (await service.roomAction(host._id, payload(game, "HIT"))).game;
    assert.equal(game.currentPlayerId, host._id);
    assert.equal(game.turnDeadline, deadline + extension);
    assert.equal(updates.at(-1).game.turnDeadline, game.turnDeadline);
    assert.equal(
      service.roomView(guest._id).game.turnDeadline,
      game.turnDeadline,
    );
  });
}

test("extensions accumulate at most three times, survive views and reconnect, and reset for the next turn", async (t) => {
  const { service } = setup(t, {
    shoeFactory: () =>
      testShoe("2", "3", "10", "2", "4", "7", "2", "2", "2", "2", "2"),
  });
  let { game } = await service.startRoom(host._id);
  const initial = game.turnDeadline;
  t.mock.timers.tick(15000);
  for (let index = 1; index <= 4; index++) {
    if (index > 1) t.mock.timers.tick(5000);
    game = (await service.roomAction(host._id, payload(game, "HIT"))).game;
    assert.equal(game.turnDeadline, initial + Math.min(index, 3) * 5000);
    await service.setConnected(host._id, true);
    assert.equal(
      service.roomView(host._id).game.turnDeadline,
      game.turnDeadline,
    );
  }
  game = (await service.roomAction(host._id, payload(game))).game;
  assert.equal(game.currentPlayerId, guest._id);
  assert.equal(game.turnDeadline, Date.now() + 30000);
  t.mock.timers.tick(15000);
  const guestDeadline = game.turnDeadline;
  game = (await service.roomAction(guest._id, payload(game, "HIT"))).game;
  assert.equal(game.turnDeadline, guestDeadline + 5000);
});

test("the original timeout cannot stand an extended turn, and the new timeout stands it once", async (t) => {
  const { service, updates } = setup(t);
  let { game } = await service.startRoom(host._id);
  t.mock.timers.tick(15000);
  game = (await service.roomAction(host._id, payload(game, "HIT"))).game;
  const revision = game.revision;
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(service.roomView(host._id).game.currentPlayerId, host._id);
  assert.equal(service.roomView(host._id).game.revision, revision);
  const count = updates.length;
  t.mock.timers.tick(5000);
  await flush();
  game = service.roomView(host._id).game;
  assert.equal(game.currentPlayerId, guest._id);
  assert.equal(game.revision, revision + 1);
  assert.equal(updates.length, count + 1);
});

for (const [card, status] of [
  ["10", "bust"],
  ["8", "stood"],
]) {
  test(`a HIT that causes ${status} does not extend the old turn`, async (t) => {
    const { service, updates } = setup(t, {
      shoeFactory: () => testShoe("6", "3", "10", "7", "4", "7", card),
    });
    let { game } = await service.startRoom(host._id);
    const oldDeadline = game.turnDeadline;
    t.mock.timers.tick(15000);
    game = (await service.roomAction(host._id, payload(game, "HIT"))).game;
    assert.equal(game.players[0].status, status);
    assert.equal(game.currentPlayerId, guest._id);
    assert.equal(game.turnDeadline, Date.now() + 30000);
    assert.ok(
      updates.every(
        (room) =>
          room.game?.currentPlayerId !== host._id ||
          room.game.turnDeadline === oldDeadline,
      ),
    );
  });
}

test("a round-ending HIT never publishes an extension", async (t) => {
  const { service, updates } = setup(t, {
    shoeFactory: () => testShoe("2", "6", "10", "2", "7", "7", "8"),
  });
  let { game } = await service.startRoom(host._id);
  game = (await service.roomAction(host._id, payload(game))).game;
  const deadline = game.turnDeadline;
  t.mock.timers.tick(15000);
  game = (await service.roomAction(guest._id, payload(game, "HIT"))).game;
  assert.equal(game.status, "complete");
  assert.equal(game.players[1].status, "stood");
  assert.equal(game.turnDeadline, null);
  assert.ok(
    updates.every((room) => room.game?.turnDeadline !== deadline + 5000),
  );
});

test("concurrent, duplicate, stale, invalid and out-of-turn actions cannot add time", async (t) => {
  const { service } = setup(t);
  let { game } = await service.startRoom(host._id);
  const deadline = game.turnDeadline;
  t.mock.timers.tick(15000);
  await assert.rejects(
    service.roomAction(guest._id, payload(game, "HIT")),
    /turn/,
  );
  await assert.rejects(
    service.roomAction(host._id, payload(game, "INVALID")),
    /action/,
  );
  const request = payload(game, "HIT");
  const results = await Promise.allSettled([
    service.roomAction(host._id, request),
    service.roomAction(host._id, request),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  await assert.rejects(service.roomAction(host._id, request), /changed/);
  game = service.roomView(host._id).game;
  assert.equal(game.turnDeadline, deadline + 5000);
  await service.roomAdvice(host._id, payload(game));
  assert.equal(service.roomView(host._id).game.turnDeadline, deadline + 5000);
});

test("actions after expiration are rejected even before the timeout callback runs", async (t) => {
  const { service } = setup(t);
  const { game } = await service.startRoom(host._id);
  t.mock.timers.setTime(game.turnDeadline + 1);
  await assert.rejects(
    service.roomAction(host._id, payload(game, "HIT")),
    /expired/,
  );
  assert.equal(service.roomView(host._id).game.currentPlayerId, guest._id);
});

test("timeout uses normal STAND results, saves all humans once, and stops after completion", async (t) => {
  const repository = testRepository();
  const saves = [];
  const saveRound = repository.saveRound.bind(repository);
  repository.saveRound = async (game) => {
    saves.push(game);
    await saveRound(game);
  };
  const { service, updates } = setup(t, {
    repository,
    shoeFactory: () => testShoe("10", "10", "10", "10", "8", "7"),
  });
  await service.startRoom(host._id);
  t.mock.timers.tick(30000);
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  const { game } = service.roomView(host._id);
  assert.deepEqual(
    game.players.map((player) => player.result),
    ["win", "win"],
  );
  assert.equal(saves.length, 1);
  assert.equal((await repository.getHistory(host._id)).length, 1);
  assert.equal((await repository.getHistory(guest._id)).length, 1);
  const count = updates.length;
  t.mock.timers.tick(90000);
  await flush();
  assert.equal(updates.length, count);
  assert.equal(saves.length, 1);
});

test("a deadline expiring during advice retries after the room lock is released", async (t) => {
  let release;
  const { service } = setup(t, {
    predict: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const { game } = await service.startRoom(host._id);
  const advice = service.roomAdvice(host._id, payload(game));
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  assert.equal(service.roomView(host._id).game.currentPlayerId, host._id);
  release({ action: "STAND" });
  await advice;
  t.mock.timers.tick(100);
  await flush();
  assert.equal(service.roomView(host._id).game.currentPlayerId, guest._id);
});

test("expired actions cannot beat a delayed timer callback or act twice", async (t) => {
  const { service } = setup(t);
  const { game } = await service.startRoom(host._id);
  // Move wall time without running callbacks, simulating an occupied event loop.
  t.mock.timers.setTime(game.turnDeadline);
  const results = await Promise.allSettled([
    service.roomAction(host._id, payload(game, "HIT")),
    service.roomAction(host._id, payload(game)),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    0,
  );
  const current = service.roomView(host._id).game;
  assert.equal(current.revision, game.revision + 1);
  assert.equal(current.players[0].hand.length, 2);
  assert.equal(current.players[0].status, "stood");
  assert.equal(current.currentPlayerId, guest._id);
  await assert.rejects(service.roomAction(guest._id, payload(game)), /changed/);
});

test("an action just before expiry and its stale callback leave later rounds intact", async (t) => {
  const { service, updates } = setup(t);
  let { game } = await service.startRoom(host._id);
  t.mock.timers.tick(10000);
  game = (await service.roomAction(host._id, payload(game))).game;
  game = (await service.roomAction(guest._id, payload(game))).game;
  assert.equal(game.turnDeadline, null);
  game = (await service.startRoom(host._id)).game;
  const deadline = game.turnDeadline;
  t.mock.timers.tick(20000);
  await flush();
  assert.equal(service.roomView(host._id).game.turnDeadline, deadline);
  assert.equal(service.roomView(host._id).game.currentPlayerId, host._id);
  await service.leaveRoom(host._id);
  await service.leaveRoom(guest._id);
  const count = updates.length;
  t.mock.timers.tick(90000);
  await flush();
  assert.equal(service.roomView(host._id), null);
  assert.equal(updates.length, count);
});

test("disconnect still stands immediately; reconnect does not restart the next turn", async (t) => {
  const { service } = setup(t);
  await service.startRoom(host._id);
  t.mock.timers.tick(5000);
  await service.setConnected(host._id, false);
  const { game } = service.roomView(guest._id);
  assert.equal(game.players[0].status, "disconnected");
  assert.equal(game.turnDeadline, Date.now() + 30000);
  t.mock.timers.tick(5000);
  await service.setConnected(host._id, true);
  assert.equal(service.roomView(host._id).game.turnDeadline, game.turnDeadline);
});

test("timeout completion keeps persistence failure retryable without a running timer", async (t) => {
  let available = false;
  const repository = testRepository();
  repository.saveRound = async () => {
    if (!available) throw new Error("offline");
  };
  const { service } = setup(t, { repository });
  let { game } = await service.startRoom(host._id);
  game = (await service.roomAction(host._id, payload(game))).game;
  t.mock.timers.tick(30000);
  await flush();
  game = service.roomView(host._id).game;
  assert.equal(game.status, "complete");
  assert.equal(game.turnDeadline, null);
  assert.equal(game.saved, false);
  await assert.rejects(service.startRoom(host._id), /Save/);
  available = true;
  assert.equal((await service.retryRoomSave(host._id)).game.saved, true);
});

test("single-player has no deadline or automatic action", async (t) => {
  const { service } = setup(t);
  const user = { _id: "solo", username: "Solo" };
  const game = await service.startSingle(user, 0);
  assert.equal("turnDeadline" in game, false);
  t.mock.timers.tick(90000);
  await flush();
  assert.equal(service.singleView(user._id).revision, game.revision);
});
