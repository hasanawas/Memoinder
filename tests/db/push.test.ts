import { beforeAll, describe, expect, it } from "vitest";
import { dispatchDue, type PushPayload } from "../../src/lib/dispatch/dispatch.ts";
import { postgrestStore } from "../../src/lib/dispatch/postgrest-store.ts";
import { generateVapidKeys, sendPush, type VapidKeys } from "../../src/lib/push/webpush.ts";
import { fakeBrowser, verifyVapid, type FakeBrowser } from "../support/push-receiver.ts";
import { anonClient, apiUrl, awayFromMinuteBoundary, newUser, serviceRoleKey } from "../support/local-supabase.ts";

// The server half of delivery against the real local database: claim, encrypt,
// send, record, acknowledge. The "push service" is a fetch stub that checks
// the VAPID signature and decrypts the message, as Google/Mozilla/Apple would.

type User = Awaited<ReturnType<typeof newUser>>;

const endpoint = (name: string) => `https://push.example.test/${name}-${crypto.randomUUID()}`;

async function addDevice(user: User, browser: FakeBrowser, url = endpoint("dev")) {
  const { error } = await user.client.rpc("save_push_subscription", {
    p_endpoint: url,
    p_p256dh: browser.keys.p256dh,
    p_auth: browser.keys.auth,
    p_user_agent: "vitest",
  });
  if (error) throw error;
  return url;
}

async function dueReminder(user: User, title: string, recurrence: object | null = null) {
  const { data, error } = await user.client
    .from("reminders")
    .insert({ title, start_local: "2026-10-16T10:00:00", time_zone: "UTC", recurrence, next_fire_at: new Date(Date.now() - 1000).toISOString() })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

describe("devices", () => {
  let alice: User;
  let bob: User;
  beforeAll(async () => {
    alice = await newUser();
    bob = await newUser();
  });

  it("saves a device through save_push_subscription only", async () => {
    const b = await fakeBrowser();
    const url = await addDevice(alice, b);
    const { data } = await alice.client.from("push_subscriptions").select("endpoint");
    expect(data).toEqual([{ endpoint: url }]);

    const direct = await alice.client.from("push_subscriptions").insert({ endpoint: endpoint("direct"), p256dh: b.keys.p256dh, auth: b.keys.auth });
    expect(direct.error?.message).toMatch(/permission denied/);
  });

  it("rejects non-https endpoints", async () => {
    const b = await fakeBrowser();
    const { error } = await alice.client.rpc("save_push_subscription", {
      p_endpoint: "http://169.254.169.254/latest",
      p_p256dh: b.keys.p256dh,
      p_auth: b.keys.auth,
    });
    expect(error?.message).toMatch(/must be https/);
  });

  it("hands a browser over when another account signs in on it", async () => {
    const b = await fakeBrowser();
    const url = await addDevice(alice, b);
    await addDevice(bob, b, url);
    const mine = await alice.client.from("push_subscriptions").select("endpoint").eq("endpoint", url);
    const theirs = await bob.client.from("push_subscriptions").select("endpoint").eq("endpoint", url);
    expect(mine.data).toEqual([]);
    expect(theirs.data).toEqual([{ endpoint: url }]);
  });

  it("hides devices and deliveries from other users and from anonymous visitors", async () => {
    const devices = await bob.client.from("push_subscriptions").select("user_id");
    expect(devices.data?.every((d) => d.user_id === bob.userId)).toBe(true);
    const anon = await anonClient().from("deliveries").select("id");
    expect(anon.error?.message).toMatch(/permission denied/);
  });

  it("stops users from changing the dispatcher's claim columns", async () => {
    const id = await dueReminder(alice, "claim test");
    const { error } = await alice.client.from("reminders").update({ claim_id: crypto.randomUUID() }).eq("id", id);
    expect(error?.message).toMatch(/permission denied/);
    await alice.client.from("reminders").delete().eq("id", id);
  });
});

describe("dispatching against the real database", () => {
  let vapid: VapidKeys;
  const received: { url: string; payload: PushPayload }[] = [];
  const browsers = new Map<string, FakeBrowser>();
  const responses = new Map<string, number>();

  // Plays the push service: checks the VAPID token, decrypts with the browser's key.
  const pushService: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = init!.headers as Record<string, string>;
    const v = await verifyVapid(headers.Authorization, url);
    if (!v.ok || v.publicKey !== vapid.publicKey) return new Response("bad vapid", { status: 403 });
    if (!browsers.has(url) && !responses.has(url)) return new Response("unknown", { status: 404 });
    const status = responses.get(url) ?? 201;
    if (status === 201) {
      const text = await browsers.get(url)!.decrypt(new Uint8Array(init!.body as ArrayBuffer));
      received.push({ url, payload: JSON.parse(text) });
    }
    return new Response(status === 201 ? "" : "gone", { status });
  };

  const run = () =>
    dispatchDue({
      store: postgrestStore(apiUrl(), serviceRoleKey()),
      send: (target, payload, topic) => sendPush(target, payload, vapid, { fetch: pushService, topic, ttl: 600 }),
    });

  beforeAll(async () => {
    vapid = { ...(await generateVapidKeys()), subject: "mailto:test@example.test" };
  });

  it("sends to each device, records it, and accepts the device's acknowledgement", async () => {
    const user = await newUser();
    const phone = await fakeBrowser();
    const laptop = await fakeBrowser();
    const phoneUrl = await addDevice(user, phone);
    const laptopUrl = await addDevice(user, laptop);
    browsers.set(phoneUrl, phone).set(laptopUrl, laptop);

    await awayFromMinuteBoundary();
    const reminderId = await dueReminder(user, "Water the plants");
    const summary = await run();
    expect(summary.errors).toEqual([]);

    const mine = received.filter((r) => r.payload.reminderId === reminderId);
    expect(mine.map((r) => r.url).sort()).toEqual([phoneUrl, laptopUrl].sort());
    expect(mine[0].payload).toMatchObject({ v: 1, title: "Water the plants", url: "reminders/" });

    const { data: rows } = await user.client.from("deliveries").select("id,status,lateness,subscription_id").eq("reminder_id", reminderId);
    expect(rows).toHaveLength(2);
    expect(rows!.every((r) => r.status === "sent" && r.lateness === "on_time")).toBe(true);
    // The token hash is never readable by the user.
    const hash = await user.client.from("deliveries").select("ack_token_hash").eq("reminder_id", reminderId);
    expect(hash.error?.message).toMatch(/permission denied/);

    const { data: rem } = await user.client.from("reminders").select("status,next_fire_at").eq("id", reminderId).single();
    expect(rem).toEqual({ status: "completed", next_fire_at: null });

    // The Service Worker's acknowledgement needs the right token and no session.
    const p = mine.find((r) => r.url === phoneUrl)!.payload;
    const anon = anonClient();
    expect((await anon.rpc("ack_delivery", { p_id: p.deliveryId, p_token: "wrong-token-wrong-token", p_event: "displayed" })).data).toBe(false);
    expect((await anon.rpc("ack_delivery", { p_id: p.deliveryId, p_token: p.ackToken, p_event: "displayed" })).data).toBe(true);
    expect((await anon.rpc("ack_delivery", { p_id: p.deliveryId, p_token: p.ackToken, p_event: "clicked" })).data).toBe(true);
    // A later "displayed" does not undo "clicked".
    await anon.rpc("ack_delivery", { p_id: p.deliveryId, p_token: p.ackToken, p_event: "displayed" });
    const { data: acked } = await user.client.from("deliveries").select("status,displayed_at,clicked_at").eq("id", p.deliveryId).single();
    expect(acked!.status).toBe("clicked");
    expect(acked!.displayed_at).not.toBeNull();
    expect(acked!.clicked_at).not.toBeNull();
  });

  it("moves a repeating reminder forward and removes a device the push service says is gone", async () => {
    const user = await newUser();
    const dead = await fakeBrowser();
    const deadUrl = await addDevice(user, dead);
    responses.set(deadUrl, 410);

    await awayFromMinuteBoundary();
    const reminderId = await dueReminder(user, "Stretch", { freq: "daily", interval: 1 });
    await run();

    const { data: rows } = await user.client.from("deliveries").select("status,subscription_id").eq("reminder_id", reminderId);
    expect(rows).toEqual([{ status: "expired", subscription_id: null }]);
    const { data: devices } = await user.client.from("push_subscriptions").select("id");
    expect(devices).toEqual([]);
    const { data: rem } = await user.client.from("reminders").select("status,next_fire_at").eq("id", reminderId).single();
    expect(rem!.status).toBe("active");
    expect(new Date(rem!.next_fire_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("never sends the same occurrence twice, even if two runs overlap", async () => {
    const user = await newUser();
    const b = await fakeBrowser();
    const url = await addDevice(user, b);
    browsers.set(url, b);

    await awayFromMinuteBoundary();
    const reminderId = await dueReminder(user, "Only once");
    await Promise.all([run(), run(), run()]);
    expect(received.filter((r) => r.payload.reminderId === reminderId)).toHaveLength(1);
  });

  it("lets your edit win if you change a reminder while it is being sent", async () => {
    const user = await newUser();
    await awayFromMinuteBoundary();
    const reminderId = await dueReminder(user, "Edited mid-send");
    const store = postgrestStore(apiUrl(), serviceRoleKey());
    const claimed = (await store.claimDue(50)).find((r) => r.id === reminderId)!;
    expect(claimed).toBeDefined();

    const later = new Date(Date.now() + 3_600_000).toISOString();
    await user.client.from("reminders").update({ next_fire_at: later }).eq("id", reminderId);
    expect(await store.finish(reminderId, claimed.claim_id, { next_fire_at: null, status: "completed" })).toBe(false);
    const { data: rem } = await user.client.from("reminders").select("status,next_fire_at").eq("id", reminderId).single();
    expect(rem!.status).toBe("active");
    expect(new Date(rem!.next_fire_at).toISOString()).toBe(later);
  });
});
