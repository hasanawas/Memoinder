import { expect, test, type Page } from "@playwright/test";
import { go, signIn } from "../support/e2e.ts";

// The chat in a real browser against local Supabase. Ollama isn't installed in
// CI, so the "local model" tests intercept its HTTP API with page.route().

async function say(page: Page, text: string) {
  const main = page.getByRole("main");
  await main.getByLabel("Message").fill(text);
  await main.getByRole("button", { name: "Send" }).click();
}

const conversation = (page: Page) => page.getByRole("main").getByRole("list", { name: "Conversation" });

test.describe("chat with the built-in parser", () => {
  test.beforeEach(async ({ page }) => {
    // No Ollama: every request to it fails, as on a phone.
    await page.route("http://127.0.0.1:11434/**", (route) => route.abort());
    await signIn(page);
    await page.getByRole("main").getByRole("link", { name: "Chat" }).click();
    await expect(page.getByRole("main").getByRole("status")).toHaveText(/using the built-in parser/);
  });

  test("asks morning or evening, then creates after confirmation", async ({ page }) => {
    await say(page, "remind me to call mum tomorrow at 5");
    await expect(conversation(page)).toContainText("Do you mean 5 in the morning or 5 in the evening?");
    await conversation(page).getByRole("button", { name: "Evening (PM)" }).click();

    await expect(conversation(page)).toContainText("Create this reminder?");
    await expect(conversation(page)).toContainText("Call mum");
    await expect(conversation(page)).toContainText("at 17:00 (Asia/Karachi)");
    await conversation(page).getByRole("button", { name: "Create" }).click();
    await expect(conversation(page)).toContainText('Saved "Call mum"');

    await say(page, "what do I have tomorrow?");
    await expect(conversation(page)).toContainText("Tomorrow");
    await expect(conversation(page).getByRole("listitem").last()).toContainText("17:00 Call mum");

    await go(page, "/reminders/");
    await expect(page.getByRole("main").getByRole("listitem").filter({ hasText: "Call mum" })).toBeVisible();
  });

  test("creates a weekly repeat, then deletes it by name", async ({ page }) => {
    await say(page, "gym every monday and thursday at 7am");
    await expect(conversation(page)).toContainText("Every week on Mon, Thu at 07:00");
    await conversation(page).getByRole("button", { name: "Create" }).click();
    await expect(conversation(page)).toContainText('Saved "Gym"');

    await say(page, "delete the gym reminder");
    await expect(conversation(page)).toContainText('Delete "Gym"');
    await conversation(page).getByRole("button", { name: "Delete" }).click();
    await expect(conversation(page)).toContainText('Deleted "Gym"');
  });

  test("cancel saves nothing, and a missing time is asked for", async ({ page }) => {
    await say(page, "remind me to stretch");
    await expect(conversation(page)).toContainText("When should I remind you?");
    await say(page, "tomorrow at 8am");
    await expect(conversation(page)).toContainText("Create this reminder?");
    await conversation(page).getByRole("button", { name: "Cancel" }).click();
    await expect(conversation(page)).toContainText("Cancelled. Nothing was changed.");
    await go(page, "/reminders/");
    await expect(page.getByRole("main").getByText("No reminders yet")).toBeVisible();
  });
});

test.describe("chat with a local model", () => {
  async function fakeOllama(page: Page, reply: (body: { messages: { content: string }[] }) => string) {
    await page.route("http://127.0.0.1:11434/api/tags", (route) =>
      route.fulfill({ json: { models: [{ name: "llama3.2:3b" }] }, headers: { "Access-Control-Allow-Origin": "*" } }),
    );
    await page.route("http://127.0.0.1:11434/api/chat", async (route) => {
      if (route.request().method() === "OPTIONS") {
        return route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST",
          },
        });
      }
      const body = route.request().postDataJSON();
      await route.fulfill({
        json: { message: { role: "assistant", content: reply(body) } },
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    });
  }

  test("uses the model's structured answer, with dates still computed by the app", async ({ page }) => {
    await fakeOllama(page, () =>
      JSON.stringify({
        action: "create",
        title: "Pay rent",
        when: "next friday at 10am",
        repeat: "none",
        interval: 1,
        weekdays: [],
        target: "",
        range: "all",
      }),
    );
    await signIn(page);
    await go(page, "/reminders/chat/");
    await expect(page.getByRole("main").getByRole("status")).toHaveText("Local model: llama3.2:3b");
    await say(page, "rent is due next friday, ping me at 10");
    await expect(conversation(page)).toContainText("Pay rent");
    await expect(conversation(page)).toContainText("at 10:00 (Asia/Karachi)");
    await expect(conversation(page)).toContainText("Understood by: local model (llama3.2:3b).");
  });

  test("falls back to the built-in parser when the model answers nonsense", async ({ page }) => {
    await fakeOllama(page, () => "Sure! I'll remind you.");
    await signIn(page);
    await go(page, "/reminders/chat/");
    await expect(page.getByRole("main").getByRole("status")).toHaveText("Local model: llama3.2:3b");
    await say(page, "remind me to water plants tomorrow at 6pm");
    await expect(conversation(page)).toContainText("Water plants");
    await expect(conversation(page)).toContainText("The local model gave an unusable answer, so the built-in parser handled this.");
  });
});
