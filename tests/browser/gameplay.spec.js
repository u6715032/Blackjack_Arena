import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { readConfig } from "../../backend/src/config.js";
import {
  User,
  GameHistory,
  PlayerStatistics,
} from "../../backend/src/models/index.js";

const createdIds = [];
test.afterAll(async () => {
  if (!createdIds.length) return;
  await mongoose.connect(readConfig().mongoUri, {
    serverSelectionTimeoutMS: 8000,
  });
  await GameHistory.deleteMany({ user: { $in: createdIds } });
  await PlayerStatistics.deleteMany({ user: { $in: createdIds } });
  await User.deleteMany({ _id: { $in: createdIds } });
  await mongoose.disconnect();
});

async function register(page, label) {
  const suffix = randomUUID().slice(0, 8);
  await page.goto("/register");
  await page.getByLabel("Username", { exact: true }).fill(`${label}${suffix}`);
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${label}-${suffix}@example.test`);
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-only-password");
  await page
    .getByRole("button", { name: "Create account →", exact: true })
    .click();
  await expect(page).toHaveURL(/\/single$/);
  const response = await page.request.get("/api/auth/me");
  createdIds.push((await response.json()).user.id);
}

test("browser: register, real assistant, bot round, saved profile, mobile layout and logout", async ({
  page,
}) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /A classic game/ }),
  ).toBeVisible();
  await register(page, "Solo");
  await page.getByLabel("Neural network tablemates").selectOption("2");
  let analyzed = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page
      .getByRole("button", {
        name: attempt === 0 ? "Deal my first hand →" : "Deal next round →",
        exact: true,
      })
      .click();
    await expect(page.locator(".table-surface")).toBeVisible();
    const analyze = page.getByRole("button", {
      name: "Analyze my hand",
      exact: true,
    });
    if (await analyze.isEnabled()) {
      await analyze.click();
      await expect(
        page.getByText("MODEL RECOMMENDS", { exact: true }),
      ).toBeVisible();
      analyzed = true;
      await expect(page.getByText("Your move", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: /^Stand/ }).click();
    }
    await expect(
      page.getByText("Result saved to your history.", { exact: true }),
    ).toBeVisible({ timeout: 20000 });
    if (analyzed) break;
  }
  expect(analyzed).toBe(true);
  await page.screenshot({
    path: "test-results/single-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/single-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: /^Solo/ }).click();
  await expect(
    page.getByRole("heading", { name: "Round history" }),
  ).toBeVisible();
  await expect(page.locator("tbody tr")).not.toHaveCount(0);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(browserErrors).toEqual([]);
});

test("browser: two independent accounts join, play synchronized turns and replay", async ({
  browser,
}) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  try {
    await register(host, "Host");
    await register(guest, "Guest");
    for (const page of [host, guest]) {
      await page
        .getByRole("link", { name: "Multiplayer", exact: true })
        .click();
    }
    await host.getByRole("button", { name: "Create private room →" }).click();
    const code = await host.locator(".room-code").innerText();
    await guest.getByLabel("Room code", { exact: true }).fill(code);
    await guest.getByRole("button", { name: "Join room →" }).click();
    await expect(host.locator(".player-list li")).toHaveCount(2);
    await host.getByRole("button", { name: "Start round →" }).click();
    for (let turn = 0; turn < 4; turn += 1) {
      if (await host.locator(".round-result").count()) break;
      for (const page of [host, guest]) {
        const stand = page.getByRole("button", { name: /^Stand/ });
        if (await stand.isEnabled()) await stand.click();
      }
      await host.waitForTimeout(200);
    }
    for (const page of [host, guest])
      await expect(
        page.getByText("Result saved to your history.", { exact: true }),
      ).toBeVisible();
    const hostTotals = await host
      .locator(".player-hand .total")
      .allTextContents();
    expect(
      await guest.locator(".player-hand .total").allTextContents(),
    ).toEqual(hostTotals);
    await host.screenshot({
      path: "test-results/multiplayer-desktop.png",
      fullPage: true,
    });
    await host
      .getByRole("button", { name: "Deal next round →", exact: true })
      .click();
    await expect(host.locator(".table-surface")).toBeVisible();
    await guest.getByRole("button", { name: "Leave room ↗" }).click();
    await expect(host.locator(".player-list li")).toHaveCount(1);
    if (await host.getByRole("button", { name: /^Stand/ }).isEnabled())
      await host.getByRole("button", { name: /^Stand/ }).click();
    await host.getByRole("button", { name: "Leave room ↗" }).click();
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
});
