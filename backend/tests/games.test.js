import test from "node:test";
import assert from "node:assert/strict";
import { createGameService } from "../src/services/games.js";
import { createAiClient } from "../src/services/ai.js";
import { testRepository, testShoe } from "./helpers.js";

const human = { _id: "human", username: "Student" };
const standPrediction = {
  action: "STAND",
  scores: { hit: 0.1, stand: 0.9 },
  explanation: "Test fixture.",
};

test("bots consume their own features; assistant never acts; results save once", async () => {
  const seen = [];
  const repository = testRepository();
  let saves = 0;
  const originalSave = repository.saveRound;
  repository.saveRound = async (game) => {
    saves += 1;
    return originalSave(game);
  };
  const service = createGameService({
    repository,
    predict: async (features) => {
      seen.push(features);
      return standPrediction;
    },
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7"),
  });
  const game = await service.startSingle(human, 1);
  const advice = await service.singleAdvice("human", {
    roundId: game.id,
    revision: 0,
  });
  assert.equal(advice.action, "STAND");
  assert.equal(service.singleView("human").revision, 0);
  assert.deepEqual(seen[0], { total: 11, dealer: 10, soft: 0, cards: 2 });
  const finished = await service.singleAction("human", {
    action: "STAND",
    roundId: game.id,
    revision: 0,
  });
  assert.equal(finished.status, "complete");
  assert.equal(finished.saved, true);
  assert.deepEqual(seen[1], { total: 13, dealer: 10, soft: 0, cards: 2 });
  await service.retrySingle("human");
  assert.equal(saves, 1);
  await assert.rejects(
    service.singleAction("human", {
      action: "HIT",
      roundId: game.id,
      revision: 0,
    }),
    /changed/,
  );
});

test("AI outage visibly pauses a bot and retries the real prediction without substitution", async () => {
  let available = false;
  const service = createGameService({
    repository: testRepository(),
    predict: async () => {
      if (!available) throw new Error("offline");
      return standPrediction;
    },
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7"),
  });
  const game = await service.startSingle(human, 1);
  const paused = await service.singleAction("human", {
    action: "STAND",
    roundId: game.id,
    revision: 0,
  });
  assert.equal(paused.status, "playing");
  assert.match(paused.aiError, /paused/);
  assert.equal(paused.currentPlayerId, "bot-1");
  available = true;
  const finished = await service.retrySingle("human");
  assert.equal(finished.status, "complete");
});

test("AI HTTP outage is explicit", async () => {
  await assert.rejects(
    createAiClient("http://127.0.0.1:1")({
      total: 16,
      dealer: 10,
      soft: 0,
      cards: 2,
    }),
    /No substitute/,
  );
});

test("failed persistence keeps round retryable and blocks replacing it", async () => {
  let savesWork = false;
  const repository = testRepository();
  repository.saveRound = async () => {
    if (!savesWork) throw new Error("offline");
  };
  const service = createGameService({
    repository,
    predict: async () => standPrediction,
    shoeFactory: () => testShoe("10", "10", "8", "7"),
  });
  const game = await service.startSingle(human, 0);
  const complete = await service.singleAction("human", {
    action: "STAND",
    roundId: game.id,
    revision: 0,
  });
  assert.equal(complete.saved, false);
  assert.match(complete.saveError, /not saved/);
  await assert.rejects(service.startSingle(human, 0), /Save/);
  savesWork = true;
  assert.equal((await service.retrySingle("human")).saved, true);
});

test("duplicate simultaneous actions are rejected while AI is awaited", async () => {
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const service = createGameService({
    repository: testRepository(),
    predict: () => response,
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7"),
  });
  const game = await service.startSingle(human, 1);
  const first = service.singleAction("human", {
    action: "STAND",
    roundId: game.id,
    revision: 0,
  });
  await assert.rejects(
    service.singleAction("human", {
      action: "STAND",
      roundId: game.id,
      revision: 0,
    }),
    /already/,
  );
  release(standPrediction);
  await first;
});

test("room privacy, host transfer, reconnect policy and stale advice", async () => {
  const service = createGameService({
    repository: testRepository(),
    predict: async () => standPrediction,
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7"),
  });
  const host = { _id: "host", username: "Host" };
  const guest = { _id: "guest", username: "Guest" };
  let room = service.createRoom(host);
  service.joinRoom(guest, room.code);
  room = await service.startRoom(host._id);
  await assert.rejects(
    service.roomAdvice(guest._id, {
      roundId: room.game.id,
      revision: room.game.revision,
    }),
    /active turn/,
  );
  await assert.rejects(
    service.roomAdvice(host._id, { roundId: room.game.id, revision: -1 }),
    /changed/,
  );
  await service.setConnected(host._id, false);
  room = service.roomView(guest._id);
  assert.equal(room.hostId, guest._id);
  assert.equal(room.game.currentPlayerId, guest._id);
  assert.equal(room.game.players[0].status, "disconnected");
  await service.setConnected(host._id, true);
  assert.equal(
    service.roomView(host._id).game.players[0].status,
    "disconnected",
  );
  await assert.rejects(
    service.roomAction(host._id, {
      action: "HIT",
      roundId: room.game.id,
      revision: room.game.revision,
    }),
    /turn/,
  );
});

test("unsaved multiplayer completion is retained when the final player tries to leave", async () => {
  let saveWorks = false;
  const repository = testRepository();
  repository.saveRound = async () => {
    if (!saveWorks) throw new Error("offline");
  };
  const service = createGameService({
    repository,
    predict: async () => standPrediction,
    shoeFactory: () => testShoe("5", "6", "10", "6", "7", "7"),
  });
  const host = { _id: "host", username: "Host" };
  const guest = { _id: "guest", username: "Guest" };
  const room = service.createRoom(host);
  service.joinRoom(guest, room.code);
  await service.startRoom(host._id);
  await service.leaveRoom(host._id);
  await assert.rejects(service.leaveRoom(guest._id), /Save/);
  assert.equal(service.roomView(guest._id).game.saved, false);
  saveWorks = true;
  await service.retryRoomSave(guest._id);
  await service.leaveRoom(guest._id);
  assert.equal(service.roomView(guest._id), null);
});
