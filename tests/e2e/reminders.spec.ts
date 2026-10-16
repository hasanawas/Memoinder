import { expect, test, type Page } from "@playwright/test";
import { DateTime } from "luxon";

// Full journey against the real app and local Supabase: sign up, create,
// see it listed with the right next time, edit it into a repeat, delete it.
//
// Next.js keeps recently visited pages mounted but hidden, so lookups go
// through getByRole("main"), which only matches the visible page.

async function signUp(page: Page) {
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  await page.goto("/login");
  await page.getByRole("main").getByLabel("Email").fill(email);
  await page.getByRole("main").getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("main").getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/reminders$/);
  return email;
}

test("signed-out visitors are sent to the sign-in page", async ({ page }) => {
  await page.goto("/reminders");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows an error", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("main").getByLabel("Email").fill("nobody@example.test");
  await page.getByRole("main").getByLabel("Password").fill("wrong-password");
  await page.getByRole("main").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main").getByText("Invalid login credentials")).toBeVisible();
});

test("create, list, edit and delete a reminder", async ({ page }) => {
  const email = await signUp(page);
  await expect(page.getByRole("banner").getByText(email)).toBeVisible();
  await expect(page.getByRole("main").getByText("No reminders yet")).toBeVisible();

  // The browser runs in Asia/Karachi (playwright.config.ts), so that is the default zone.
  const day = DateTime.now().setZone("Asia/Karachi").plus({ days: 3 });
  await page.getByRole("main").getByRole("link", { name: "New reminder" }).click();
  await expect(page.getByRole("main").getByLabel("Time zone")).toHaveValue("Asia/Karachi");
  await page.getByRole("main").getByLabel("Title", { exact: true }).fill("Call the bank");
  await page.getByRole("main").getByLabel("Notes (optional)").fill("Ask about fees");
  await page.getByRole("main").getByLabel("Date").fill(day.toISODate()!);
  await page.getByRole("main").getByLabel("Time", { exact: true }).fill("09:00");
  await page.getByRole("main").getByRole("button", { name: "Save reminder" }).click();

  await expect(page).toHaveURL(/\/reminders$/);
  const item = page.getByRole("main").getByRole("listitem").filter({ hasText: "Call the bank" });
  await expect(item).toContainText("Ask about fees");
  await expect(item).toContainText(`Next: ${day.toFormat("ccc d LLL yyyy")}, 09:00`);
  await expect(item).toContainText("Once on");

  // Edit: rename and make it weekly on Mondays and Wednesdays.
  await item.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("main").getByLabel("Title", { exact: true })).toHaveValue("Call the bank");
  await page.getByRole("main").getByLabel("Title", { exact: true }).fill("Call the bank (weekly)");
  await page.getByRole("main").getByLabel("Repeat", { exact: true }).selectOption("weekly");
  await page.getByRole("main").getByLabel("Mon").check();
  await page.getByRole("main").getByLabel("Wed").check();
  await page.getByRole("main").getByRole("button", { name: "Save changes" }).click();

  await expect(page).toHaveURL(/\/reminders$/);
  const edited = page.getByRole("main").getByRole("listitem").filter({ hasText: "Call the bank (weekly)" });
  await expect(edited).toContainText("Every week on Mon, Wed at 09:00 (Asia/Karachi)");
  await expect(edited).toContainText("then");

  await edited.getByRole("button", { name: /Delete/ }).click();
  await expect(page.getByRole("main").getByText("No reminders yet")).toBeVisible();
});

test("shows validation errors and keeps what was typed", async ({ page }) => {
  await signUp(page);
  await page.goto("/reminders/new");
  await page.getByRole("main").getByLabel("Title", { exact: true }).fill("Too late");
  await page.getByRole("main").getByLabel("Date").fill("2020-01-01");
  await page.getByRole("main").getByLabel("Time", { exact: true }).fill("09:00");
  await page.getByRole("main").getByRole("button", { name: "Save reminder" }).click();
  await expect(page.getByRole("main").getByText("That time has already passed")).toBeVisible();
  await expect(page.getByRole("main").getByLabel("Title", { exact: true })).toHaveValue("Too late");
});
