import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApplication } from "../src/app.js";
import { testConfig, testRepository } from "./helpers.js";

test("API limits separate signed users and group forged sessions with anonymous traffic", async () => {
  const application = createApplication({
    config: testConfig,
    repository: testRepository(),
  });
  application.server.listen(0, "127.0.0.1");
  await once(application.server, "listening");
  const client = request(application.server);
  const token = (subject) =>
    jwt.sign({ version: 0 }, testConfig.jwtSecret, {
      subject,
      expiresIn: "8h",
      algorithm: "HS256",
      issuer: "blackjack-arena",
      audience: "blackjack-web",
    });
  try {
    const first = `blackjack_session=${token("first")}`;
    const second = `blackjack_session=${token("second")}`;
    for (let batch = 0; batch < 10; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 24 }, () =>
          client.get("/api/health").set("Cookie", first),
        ),
      );
      assert.ok(responses.every((response) => response.status === 200));
    }
    await client.get("/api/health").set("Cookie", first).expect(429);
    await client.get("/api/health").set("Cookie", second).expect(200);
    for (let batch = 0; batch < 10; batch++) {
      const responses = await Promise.all(
        Array.from({ length: 24 }, (_, index) =>
          client
            .get("/api/health")
            .set("Cookie", `blackjack_session=forged-${batch}-${index}`),
        ),
      );
      assert.ok(responses.every((response) => response.status === 200));
    }
    await client.get("/api/health").expect(429);
  } finally {
    application.io.close();
  }
});
