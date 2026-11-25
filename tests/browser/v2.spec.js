import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import {
  cleanupBrowserUsers,
  requireBrowserTestDatabase,
} from "./test-storage.js";

const ids = [];
test.beforeAll(() => requireBrowserTestDatabase());
test.afterAll(() => cleanupBrowserUsers(ids));

test("two players use friends, chat, chips, loans, wheel and blackjack", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const users = [];
    for (const context of contexts) {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
      const username = `V2${suffix}`;
      const response = await context.request.post(
        "http://localhost:5173/api/auth/register",
        {
          data: {
            username,
            email: `${suffix}@example.test`,
            password: "browser-test-password",
          },
        },
      );
      expect(response.status()).toBe(201);
      const { user } = await response.json();
      ids.push(user.id);
      users.push(user);
    }
    const [first, second] = await Promise.all(
      contexts.map((context) => context.newPage()),
    );
    await Promise.all([
      first.goto("http://localhost:5173/"),
      second.goto("http://localhost:5173/"),
    ]);
    await expect(
      first.getByRole("heading", {
        name: `Welcome back, ${users[0].username}.`,
      }),
    ).toBeVisible();
    await expect(first.locator(".leaderboard li").first()).toBeVisible();
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 390, height: 844 },
    ]) {
      await first.setViewportSize(viewport);
      await first.waitForTimeout(250);
      expect(
        await first.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await first.screenshot({
        path: `test-results/v2-home-${viewport.width}.png`,
        fullPage: viewport.width < 600,
        animations: "disabled",
      });
    }
    await first.setViewportSize({ width: 1366, height: 768 });
    await first.getByLabel("Search usernames").fill(users[1].username);
    await first.getByRole("button", { name: "Search", exact: true }).click();
    await first
      .locator(".friend-row")
      .filter({ hasText: users[1].username })
      .getByRole("button", { name: "Add" })
      .click();
    const incoming = second
      .locator(".friend-row")
      .filter({ hasText: users[0].username });
    await expect(
      incoming.getByRole("button", { name: "Accept", exact: true }),
    ).toBeVisible();
    await incoming.getByRole("button", { name: "Accept", exact: true }).click();
    await first
      .getByRole("button", { name: new RegExp(users[1].username) })
      .click();
    await second
      .getByRole("button", { name: new RegExp(users[0].username) })
      .click();
    await first
      .getByLabel("Message", { exact: true })
      .fill("Hello from the table");
    await first.locator(".chat-compose button").click();
    await expect(
      second.locator(".chat-history").getByText("Hello from the table"),
    ).toBeVisible();
    await first.getByText("Send or borrow chips").click();
    await first.getByLabel("Chip amount").fill("3");
    await first
      .locator(".chip-actions")
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await (
              await contexts[1].request.get("http://localhost:5173/api/wallet")
            ).json()
          ).chips,
      )
      .toBe(113);
    await first.getByLabel("Chip amount").fill("10");
    await first.getByRole("button", { name: "Request loan" }).click();
    await second.getByText("Send or borrow chips").click();
    const guestLoans = second.locator(".chat-finance .loan-list");
    await expect(
      guestLoans.getByRole("button", { name: "Accept terms" }),
    ).toBeVisible();
    await guestLoans.getByRole("button", { name: "Accept terms" }).click();
    const firstLoans = first.locator(".chat-finance .loan-list");
    await expect(
      firstLoans.getByRole("button", { name: "Repay" }),
    ).toBeVisible();
    await firstLoans.getByLabel(`Repayment for ${users[1].username}`).fill("3");
    await firstLoans.getByRole("button", { name: "Repay" }).click();
    await expect(firstLoans).toContainText("7 / 10 chips");
    await firstLoans.getByLabel(`Repayment for ${users[1].username}`).fill("7");
    await firstLoans.getByRole("button", { name: "Repay" }).click();
    await expect(firstLoans).toHaveCount(0);
    await first.getByRole("button", { name: "Close chat" }).click();
    await first.getByRole("button", { name: "Open wheel" }).click();
    await expect(first.getByText("100 chips: 0.1%")).toBeVisible();
    await first.getByRole("button", { name: "Spin for 2 chips" }).click();
    await expect(first.locator(".wheel-modal [role=status]")).toBeVisible({
      timeout: 10000,
    });
    await first.getByRole("button", { name: "Close wheel" }).click();
    await first.goto("http://localhost:5173/single");
    await first.getByLabel("Neural network tablemates").selectOption("0");
    await first.getByLabel("Wager (chips)").fill("5");
    await first.getByRole("button", { name: "Deal my first hand →" }).click();
    await expect(first.locator(".table-surface")).toBeVisible();
    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 390, height: 844 },
    ]) {
      await first.setViewportSize(viewport);
      await first.waitForTimeout(250);
      expect(
        await first.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await first.screenshot({
        path: `test-results/v2-table-${viewport.width}.png`,
        fullPage: viewport.width < 600,
        animations: "disabled",
      });
    }
    const stand = first.getByRole("button", { name: /^Stand/ });
    if (await stand.isEnabled()) await stand.click();
    await expect(
      first.getByText("Result saved to your history."),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
