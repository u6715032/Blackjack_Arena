import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  requireBrowserTestDatabase,
  cleanupBrowserUsers,
} from "./test-storage.js";

const createdIds = [];
test.afterAll(async () => {
  await cleanupBrowserUsers(createdIds);
});
test.beforeAll(() => requireBrowserTestDatabase());

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
      page.getByRole("heading", { name: /Welcome to the table/ }),
    ).toBeVisible();
    await expect(page.locator(".hero-actions, .learning-strip")).toHaveCount(0);
    await expect(
      page.getByText("Built to play. Designed to understand."),
    ).toHaveCount(0);
    await expect(
      page.getByText("Play blackjack with virtual chips. No real money."),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const selector of [".site-header", ".mode-card"]) {
      for (const element of await page.locator(selector).all()) {
        const box = await element.boundingBox();
        expect(box.y).toBeGreaterThanOrEqual(0);
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
      "0",
      "0",
      "—",
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
    // Dealer or both players can be dealt naturals, finishing without a turn.
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect
        .poll(
          async () =>
            (await host.getByRole("timer").count()) +
            (await host.locator(".round-result").count()),
        )
        .toBeGreaterThan(0);
      if (await host.getByRole("timer").count()) break;
      await host.getByRole("button", { name: "Deal next round →" }).click();
      await host.waitForTimeout(500);
    }
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
    const activePage = (await host
      .getByText("Your move", { exact: true })
      .isVisible())
      ? host
      : guest;
    const otherPage = activePage === host ? guest : host;
    const hand = activePage.locator(".player-hand.active-hand");
    const handLabel = await hand.getAttribute("aria-label");
    const total = parseInt(await hand.locator(".total").innerText(), 10);
    // Only HIT when no card can end the turn; backend timer tests cover other hands.
    if (total <= 9) {
      await activePage.getByRole("button", { name: /^Hit/ }).click();
      await expect(
        activePage.getByText("Your move", { exact: true }),
      ).toBeVisible();
    }
    expect(await seconds(guest)).toBeLessThanOrEqual(before);
    await host.reload();
    await expect(host.getByRole("timer")).toBeVisible();
    expect(await seconds(host)).toBeLessThanOrEqual(before);
    expect(
      Math.abs((await seconds(host)) - (await seconds(guest))),
    ).toBeLessThanOrEqual(1);
    await expect(
      host.getByRole("region", { name: handLabel }).locator(".hand-status"),
    ).toContainText("Stand", { timeout: 35000 });
    const otherStand = otherPage.getByRole("button", { name: /^Stand/ });
    if (await otherStand.isEnabled()) await otherStand.click();
    for (const page of pages) {
      await expect(
        page.getByText("Result saved to your history.", { exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("timer")).toHaveCount(0);
    }
    for (const context of contexts) {
      const history = await (await context.request.get("/api/history")).json();
      expect(history.history.length).toBeGreaterThanOrEqual(1);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
