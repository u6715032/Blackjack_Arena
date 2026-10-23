import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApplication } from "../src/app.js";
import { testRepository, testConfig, testShoe } from "./helpers.js";

test("registration, login, secure cookies, profile, private history and logout revocation", async () => {
  const repository = testRepository();
  const { app, io } = createApplication({
    config: testConfig,
    repository,
    shoeFactory: () => testShoe("10", "10", "8", "7"),
  });
  const first = request.agent(app);
  const second = request.agent(app);
  try {
    await first.get("/api/profile").expect(401);
    const registration = await first
      .post("/api/auth/register")
      .send({
        username: "StudentOne",
        email: "first@example.test",
        password: "long-test-password",
      })
      .expect(201);
    const oldCookie = registration.headers["set-cookie"][0].split(";")[0];
    assert.match(registration.headers["set-cookie"][0], /HttpOnly/);
    assert.match(registration.headers["set-cookie"][0], /SameSite=Strict/);
    assert.equal("passwordHash" in registration.body.user, false);
    await second
      .post("/api/auth/register")
      .send({
        username: "StudentTwo",
        email: "second@example.test",
        password: "long-test-password",
      })
      .expect(201);
    await first
      .post("/api/auth/register")
      .send({
        username: "StudentOne",
        email: "first@example.test",
        password: "long-test-password",
      })
      .expect(409);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "first@example.test", password: "wrong-password" })
      .expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "absent@example.test", password: "wrong-password" })
      .expect(401);
    await request(app)
      .post("/api/auth/register")
      .send({
        email: { $gt: "" },
        password: "long-test-password",
        username: "Invalid",
      })
      .expect(400);
    await first
      .post("/api/games/single")
      .set("Origin", "https://foreign.test")
      .send({ botCount: 0 })
      .expect(403);
    await first.get("/api/auth/me").expect(200);
    let game = (
      await first.post("/api/games/single").send({ botCount: 0 }).expect(201)
    ).body.game;
    assert.equal(game.dealer.total, null);
    await first
      .post("/api/games/single/action")
      .send({ action: "STAND", roundId: game.id, revision: game.revision })
      .expect(200);
    assert.equal((await first.get("/api/history")).body.history.length, 1);
    assert.equal(
      (await second.get("/api/history?user=1")).body.history.length,
      0,
    );
    assert.equal(
      (await first.get("/api/statistics")).body.statistics.totalGames,
      1,
    );
    await first.get("/api/history?page=-1").expect(400);
    await first.post("/api/auth/logout").expect(200);
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(401);
    await first
      .post("/api/auth/login")
      .send({ email: "first@example.test", password: "long-test-password" })
      .expect(200);
  } finally {
    io.close();
  }
});
