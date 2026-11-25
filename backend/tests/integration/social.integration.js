import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import request from "supertest";
import { io as connectSocket } from "socket.io-client";
import { connectDatabase, database } from "../../src/services/database.js";
import {
  User,
  ChipTransaction,
  PlayerStatistics,
  Friendship,
  Block,
  Message,
  Maintenance,
} from "../../src/models/index.js";
import { createApplication } from "../../src/app.js";
import {
  cleanupMessages,
  sendMessage,
  readConversation,
} from "../../src/services/social.js";
import { testConfig } from "../helpers.js";
import { testDatabaseUri } from "./test-database.js";

test("friendship authorization, live presence, retention, weekly cleanup and blocks", async () => {
  const ids = [],
    sockets = [];
  let application;
  try {
    const uri = new URL(testDatabaseUri());
    uri.pathname = `/social_test_${randomUUID().replaceAll("-", "")}`;
    await connectDatabase(uri.toString());
    await cleanupMessages();
    application = createApplication({
      config: testConfig,
      repository: database,
    });
    application.server.listen(0, "127.0.0.1");
    await once(application.server, "listening");
    const address = `http://127.0.0.1:${application.server.address().port}`;
    const browsers = [
      request.agent(application.app),
      request.agent(application.app),
      request.agent(application.app),
    ];
    for (let index = 0; index < browsers.length; index++) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const registration = await browsers[index]
        .post("/api/auth/register")
        .send({
          username: `Friend${suffix}`,
          email: `${suffix}@example.test`,
          password: "test-password-long",
        })
        .expect(201);
      ids.push(registration.body.user.id);
      const socket = connectSocket(address, {
        transports: ["websocket"],
        auth: { scope: "social" },
        extraHeaders: {
          Cookie: registration.headers["set-cookie"][0].split(";")[0],
          Origin: testConfig.clientOrigin,
        },
      });
      sockets.push(socket);
      await once(socket, "connect");
    }
    const [a, b, outsider] = browsers;
    const [aId, bId] = ids;
    await a.post(`/api/social/friends/${aId}/request`).expect(400);
    await a
      .post(`/api/social/messages/${bId}`)
      .send({ text: "not friends" })
      .expect(403);
    await a.post(`/api/social/friends/${bId}/request`).expect(200);
    await a.post(`/api/social/friends/${bId}/request`).expect(409);
    await a.post(`/api/social/friends/${bId}/accept`).expect(409);
    assert.equal((await b.get("/api/social")).body.incoming.length, 1);
    await b.post(`/api/social/friends/${aId}/accept`).expect(200);
    const overview = (await a.get("/api/social")).body;
    assert.equal(overview.friends[0].id, bId);
    assert.equal(overview.friends[0].online, true);
    await outsider.get(`/api/social/messages/${aId}`).expect(403);
    for (let i = 0; i < 21; i++) await sendMessage(aId, bId, `message ${i}`);
    await Promise.all([
      sendMessage(aId, bId, "parallel A"),
      sendMessage(aId, bId, "parallel B"),
    ]);
    assert.equal(await Message.countDocuments({}), 20);
    assert.equal((await b.get("/api/social")).body.friends[0].unread, 20);
    const messages = (await b.get(`/api/social/messages/${aId}`).expect(200))
      .body.messages;
    assert.equal(messages.length, 20);
    assert.ok(!messages.some((message) => message.text === "message 0"));
    assert.equal((await b.get("/api/social")).body.friends[0].unread, 0);
    await b.post(`/api/social/friends/${aId}/block`).expect(200);
    await a
      .post(`/api/social/messages/${bId}`)
      .send({ text: "blocked" })
      .expect(403);
    await a.post(`/api/social/friends/${bId}/request`).expect(403);
    await b.post(`/api/social/friends/${aId}/unblock`).expect(200);
    await a.post(`/api/social/friends/${bId}/request`).expect(200);
    await b.post(`/api/social/friends/${aId}/accept`).expect(200);
    assert.equal((await readConversation(aId, bId)).length, 20);
    await Maintenance.updateOne(
      { key: "chat" },
      { $set: { nextChatCleanupAt: new Date(0) } },
    );
    assert.equal(await cleanupMessages(), 20);
    assert.equal((await readConversation(aId, bId)).length, 0);
    await sendMessage(aId, bId, "expired message");
    await Message.updateOne(
      { sender: aId },
      { $set: { expiresAt: new Date(0) } },
    );
    assert.equal((await readConversation(aId, bId)).length, 0);
    await cleanupMessages();
    assert.equal(await Message.countDocuments({ sender: aId }), 0);
    const ttl = (await Message.collection.indexes()).find(
      (index) => index.key.expiresAt === 1,
    );
    assert.equal(ttl.expireAfterSeconds, 0);
  } finally {
    for (const socket of sockets) socket.disconnect();
    application?.io.close();
    if (ids.length) {
      for (const model of [ChipTransaction, PlayerStatistics])
        await model.deleteMany({ user: { $in: ids } });
      await Friendship.deleteMany({
        $or: [{ first: { $in: ids } }, { second: { $in: ids } }],
      });
      await Block.deleteMany({
        $or: [{ blocker: { $in: ids } }, { blocked: { $in: ids } }],
      });
      await Message.deleteMany({
        $or: [{ sender: { $in: ids } }, { recipient: { $in: ids } }],
      });
      await User.deleteMany({ _id: { $in: ids } });
      await Maintenance.deleteOne({ key: "chat" });
    }
    await mongoose.disconnect();
  }
});
