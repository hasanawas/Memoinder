import { expect, test } from "@playwright/test";
import { dispatchDue, type PushPayload } from "../../src/lib/dispatch/dispatch.ts";
import { postgrestStore } from "../../src/lib/dispatch/postgrest-store.ts";
import { generateVapidKeys, sendPush } from "../../src/lib/push/webpush.ts";
import { fakeBrowser } from "../support/push-receiver.ts";
import { go, latestCode, signIn } from "../support/e2e.ts";
import { anonClient, apiUrl, awayFromMinuteBoundary, serviceRoleKey } from "../support/local-supabase.ts";

// The device half, in a real Chromium with the Memoinder tab CLOSED:
// the dispatcher encrypts and "sends" a reminder, the test plays the push
// service (decrypts it, then hands it to the browser through DevTools, which
// is what Chrome does when the real push service delivers), and we check the
// Service Worker showed the notification and reported it back.
//
// Not covered here: the hop through Google/Mozilla/Apple's push servers, which
// this sandbox cannot reach. See docs/notifications.md for the manual check.

// Full Chromium (not the headless shell) supports notifications.
test.use({ channel: "chromium" });

test("a reminder is shown with the tab closed, and the history says so", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ timezoneId: "Asia/Karachi" });
  const origin = new URL(test.info().project.use.baseURL!).origin;
  await context.grantPermissions(["notifications"], { origin });

  // Sign up and open the reminders page, which installs the Service Worker.
  const email = `push-${crypto.randomUUID()}@example.test`;
  const page = await context.newPage();
  await signIn(page, email);
  await expect(page.getByRole("region", { name: "Notifications" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  // The same account, through the API: a device and a reminder due now.
  const api = anonClient();
  await api.auth.signInWithOtp({ email });
  expect((await api.auth.verifyOtp({ email, token: await latestCode(email), type: "email" })).error).toBeNull();
  const device = await fakeBrowser();
  const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
  expect((await api.rpc("save_push_subscription", { p_endpoint: endpoint, p_p256dh: device.keys.p256dh, p_auth: device.keys.auth })).error).toBeNull();

  // Close the tab before anything is sent.
  const devtoolsPage = await context.newPage();
  const cdp = await context.newCDPSession(devtoolsPage);
  const registrations: { registrationId: string; scopeURL: string }[] = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => registrations.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await page.close();
  await expect.poll(() => registrations.find((r) => r.scopeURL.startsWith(origin))).toBeTruthy();
  const registrationId = registrations.find((r) => r.scopeURL.startsWith(origin))!.registrationId;

  await awayFromMinuteBoundary();
  const { data: reminder } = await api
    .from("reminders")
    .insert({ title: "Call the bank", notes: "Ask about the card", start_local: "2026-10-16T15:00:00", time_zone: "Asia/Karachi", next_fire_at: new Date().toISOString() })
    .select("id")
    .single();

  const vapid = { ...(await generateVapidKeys()), subject: "mailto:test@example.test" };
  const delivered: PushPayload[] = [];
  await dispatchDue({
    store: postgrestStore(apiUrl(), serviceRoleKey()),
    send: (target, payload, topic) =>
      sendPush(target, payload, vapid, {
        topic,
        fetch: async (url, init) => {
          if (String(url) !== endpoint) return new Response("", { status: 404 });
          const text = await device.decrypt(new Uint8Array(init!.body as ArrayBuffer));
          delivered.push(JSON.parse(text));
          // What the browser's push service does: hand the message to the Service Worker.
          await cdp.send("ServiceWorker.deliverPushMessage", { origin, registrationId, data: text });
          return new Response("", { status: 201 });
        },
      }),
  });
  expect(delivered).toHaveLength(1);
  expect(delivered[0].reminderId).toBe(reminder!.id);

  // The notification is on screen even though no Memoinder tab was open.
  const check = await context.newPage();
  await go(check, "/");
  await expect
    .poll(() => check.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}|${n.body}`)))
    .toEqual([expect.stringMatching(/^Call the bank\|Ask about the card\n\w{3} \d{1,2} \w{3}, \d\d:\d\d$/)]);

  // The Service Worker told the server, so the history can honestly say "shown".
  await go(check, "/reminders/history/");
  await expect(check.getByRole("main").getByText("Shown on your device")).toBeVisible();
  await go(check, "/reminders/list/");
  await expect(check.getByRole("main").getByTestId("last-delivery")).toContainText("Shown on your device");
  await context.close();
});

test("the notifications panel offers to turn notifications on", async ({ page }) => {
  await signIn(page);
  const panel = page.getByRole("region", { name: "Notifications" });
  await expect(panel.getByRole("button", { name: "Turn on notifications" })).toBeVisible();
  await expect(panel.getByText("No devices have notifications on.")).toBeVisible();
});
