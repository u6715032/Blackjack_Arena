import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { readConfig } from "../../backend/src/config.js";
import {
  User,
  GameHistory,
  PlayerStatistics,
  RoundReceipt,
} from "../../backend/src/models/index.js";

const createdIds = [];
test.afterAll(async () => {
  if (!createdIds.length) return;
  await mongoose.connect(readConfig().mongoUri, {
    serverSelectionTimeoutMS: 8000,
  });
  for (const model of [GameHistory, RoundReceipt, PlayerStatistics])
    await model.deleteMany({ user: { $in: createdIds } });
  await User.deleteMany({ _id: { $in: createdIds } });
  await mongoose.disconnect();
});

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]) {
  test(`homepage fits ${viewport.width}×${viewport.height} and preserves other page spacing`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    await expect(
      page.getByRole("heading", { name: /A classic game/ }),
    ).toBeVisible();
    await expect(page.locator(".hero-actions, .learning-strip")).toHaveCount(0);
    await expect(
      page.getByText("Built to play. Designed to understand."),
    ).toHaveCount(0);
    await expect(
      page.getByText("No bets. No money. Just the game."),
    ).toBeVisible();
    await expect(page.locator(".hero-art .playing-card")).toHaveCount(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(viewport.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const selector of [".site-header", ".mode-card", "footer"]) {
      for (const element of await page.locator(selector).all()) {
        const box = await element.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
    }
    await expect(page.locator('.mode-card[href="/single"]')).toHaveCount(1);
    await expect(page.locator('.mode-card[href="/multiplayer"]')).toHaveCount(
      1,
    );
    await page.locator('.mode-card[href="/single"]').click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      await page
        .locator("main")
        .evaluate((element) => getComputedStyle(element).paddingBottom),
    ).toBe("80px");
    expect(
      await page
        .locator("footer")
        .evaluate((element) => getComputedStyle(element).paddingTop),
    ).toBe("28px");
    expect(
      await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).overflowY),
    ).not.toBe("hidden");
  });
}

test("mobile homepage scrolls naturally with both mode cards and footer accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight,
    ),
  ).toBe(true);
  for (const element of await page.locator(".mode-card, footer").all()) {
    await element.scrollIntoViewIfNeeded();
    await expect(element).toBeVisible();
  }
  await page.locator('.mode-card[href="/multiplayer"]').click();
  await expect(page).toHaveURL(/\/login$/);
});

for (const count of [0, 20]) {
  test(`profile shows ${count} rounds with no pagination and unchanged lifetime cards`, async ({
    page,
  }) => {
    const user = {
      id: "profile-fixture",
      username: "ProfileFixture",
      email: "fixture@example.test",
      createdAt: "2025-01-01",
    };
    const history = Array.from({ length: count }, (_, index) => ({
      _id: String(index),
      playedAt: new Date(1700000000000 - index * 1000).toISOString(),
      mode: index % 2 ? "multi" : "single",
      playerTotal: 21 - index,
      dealerTotal: 17,
      result: "win",
    }));
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({ json: { user } }),
    );
    await page.route("**/api/profile", (route) =>
      route.fulfill({
        json: {
          user,
          statistics: {
            totalGames: 30,
            wins: 20,
            losses: 6,
            pushes: 4,
            winPercentage: 66.67,
          },
        },
      }),
    );
    await page.route("**/api/history", (route) =>
      route.fulfill({ json: { history, pageSize: 20 } }),
    );
    await page.goto("/profile");
    await expect(page.locator("tbody tr")).toHaveCount(count);
    await expect(
      page.getByText("Latest 20 rounds", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Previous|Next/ }),
    ).toHaveCount(0);
    await expect(page.locator(".statistic strong")).toHaveText([
      "30",
      "20",
      "6",
      "4",
      "66.67%",
    ]);
    if (!count)
      await expect(
        page.getByText("No rounds yet. Your completed hands will appear here."),
      ).toBeVisible();
    else {
      await expect(
        page.locator("tbody tr").first().locator("td").nth(2),
      ).toHaveText("21");
      await expect(
        page.locator("tbody tr").last().locator("td").nth(2),
      ).toHaveText("2");
    }
  });
}

test("live multiplayer countdown stays synchronized through HIT and refresh, then automatically stands", async ({
  browser,
}) => {
  const contexts = await Promise.all([
    browser.newContext({ baseURL: "http://localhost:5173" }),
    browser.newContext({ baseURL: "http://localhost:5173" }),
  ]);
  try {
    const pages = [];
    for (const context of contexts) {
      const suffix = randomUUID().slice(0, 8);
      const response = await context.request.post("/api/auth/register", {
        data: {
          username: `Timer${suffix}`,
          email: `${suffix}@example.test`,
          password: "browser-timer-password",
        },
      });
      expect(response.status()).toBe(201);
      createdIds.push((await response.json()).user.id);
      pages.push(await context.newPage());
    }
    const [host, guest] = pages;
    // A five-minute device clock difference must not change the displayed deadline.
    await host.clock.install({ time: new Date(Date.now() + 300000) });
    for (const page of pages) await page.goto("/multiplayer");
    await host.getByRole("button", { name: "Create private room →" }).click();
    const code = await host.locator(".room-code").innerText();
    await guest.getByLabel("Room code", { exact: true }).fill(code);
    await guest.getByRole("button", { name: "Join room →" }).click();
    await expect(host.locator(".player-list li")).toHaveCount(2);
    await expect(host.getByRole("timer")).toHaveCount(0);
    await host.getByRole("button", { name: "Start round →" }).click();
    await expect(host.getByRole("timer")).toBeVisible();
    await expect(guest.getByRole("timer")).toBeVisible();
    const seconds = async (page) =>
      parseInt(await page.getByRole("timer").innerText(), 10);
    expect(
      Math.abs((await seconds(host)) - (await seconds(guest))),
    ).toBeLessThanOrEqual(1);
    expect(await seconds(host)).toBeGreaterThanOrEqual(28);
    // Keep a second connection so refresh preserves the established disconnect/stand policy.
    const backup = await contexts[0].newPage();
    await backup.goto("/multiplayer");
    await expect(backup.getByRole("timer")).toBeVisible();
    await expect.poll(() => seconds(guest)).toBeLessThanOrEqual(27);
    const before = await seconds(guest);
    await host.getByRole("button", { name: /^Hit/ }).click();
    await expect(host.getByText("Your move", { exact: true })).toBeVisible();
    expect(await seconds(guest)).toBeLessThanOrEqual(before);
    await host.reload();
    await expect(host.getByRole("timer")).toBeVisible();
    expect(await seconds(host)).toBeLessThanOrEqual(before);
    expect(
      Math.abs((await seconds(host)) - (await seconds(guest))),
    ).toBeLessThanOrEqual(1);
    await expect(guest.getByText("Your move", { exact: true })).toBeVisible({
      timeout: 35000,
    });
    expect(await seconds(guest)).toBeGreaterThanOrEqual(28);
    await expect(
      host.locator(".player-hand").first().locator(".hand-status"),
    ).toHaveText("Stand");
    await guest.getByRole("button", { name: /^Stand/ }).click();
    for (const page of pages) {
      await expect(
        page.getByText("Result saved to your history.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("timer")).toHaveCount(0);
    }
    for (const context of contexts) {
      const history = await (await context.request.get("/api/history")).json();
      expect(history.history).toHaveLength(1);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
