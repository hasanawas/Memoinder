import { expect, test } from "@playwright/test";

test("home page shows the app name and build progress", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Memoinder");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Memoinder");
  await expect(page.getByRole("heading", { name: /phases complete/ })).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(6);
});
