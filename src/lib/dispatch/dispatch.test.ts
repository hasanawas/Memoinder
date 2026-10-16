import { describe, expect, it } from "vitest";
import type { PushResult, PushTarget } from "../push/webpush.ts";
import { dispatchDue, type DeliveryRow, type DispatchStore, type DueReminder, type PushPayload, type ReminderUpdate, type Subscription } from "./dispatch.ts";

function fakeStore(due: DueReminder[], subs: Subscription[], opts: { loseClaim?: boolean } = {}) {
  const deliveries: DeliveryRow[] = [];
  const finished: { id: string; claimId: string; update: ReminderUpdate }[] = [];
  const subResults: { sent: string[]; failed: string[]; expired: string[] }[] = [];
  const store: DispatchStore = {
    claimDue: async () => due,
    subscriptionsFor: async (ids) => subs.filter((s) => ids.includes(s.user_id)),
    recordDeliveries: async (rows) => void deliveries.push(...rows),
    finish: async (id, claimId, update) => (finished.push({ id, claimId, update }), !opts.loseClaim),
    subscriptionResults: async (sent, failed, expired) => void subResults.push({ sent, failed, expired }),
  };
  return { store, deliveries, finished, subResults };
}

const reminder = (over: Partial<DueReminder> = {}): DueReminder => ({
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "u1",
  title: "Take medicine",
  notes: null,
  start_local: "2026-10-16T09:00:00",
  time_zone: "Asia/Karachi",
  recurrence: null,
  next_fire_at: "2026-10-16T04:00:00Z",
  claim_id: "c1",
  ...over,
});

const sub = (id: string, user_id = "u1"): Subscription => ({ id, user_id, endpoint: `https://push.example/${id}`, p256dh: "k", auth: "a" });

function sender(outcomes: Record<string, PushResult["outcome"]> = {}) {
  const calls: { target: PushTarget; payload: PushPayload; topic: string }[] = [];
  const send = async (target: PushTarget, payload: string, topic: string): Promise<PushResult> => {
    calls.push({ target, payload: JSON.parse(payload), topic });
    const outcome = outcomes[target.endpoint] ?? "sent";
    return { outcome, status: outcome === "sent" ? 201 : outcome === "expired" ? 410 : 500, ...(outcome === "failed" ? { error: "boom" } : {}) };
  };
  return { send, calls };
}

const at = (iso: string) => () => new Date(iso);

describe("dispatchDue", () => {
  it("does nothing when nothing is due", async () => {
    const { store, deliveries } = fakeStore([], []);
    const s = await dispatchDue({ store, send: sender().send });
    expect(s.claimed).toBe(0);
    expect(deliveries).toEqual([]);
  });

  it("sends a one-off reminder to every device and completes it", async () => {
    const { store, deliveries, finished, subResults } = fakeStore([reminder()], [sub("s1"), sub("s2"), sub("other", "u2")]);
    const { send, calls } = sender();
    const s = await dispatchDue({ store, send, now: at("2026-10-16T04:00:30Z") });

    expect(calls.map((c) => c.target.endpoint)).toEqual(["https://push.example/s1", "https://push.example/s2"]);
    expect(calls[0].payload).toMatchObject({ v: 1, title: "Take medicine", url: "reminders/", reminderId: reminder().id });
    expect(calls[0].payload.body).toContain("09:00");
    expect(calls[0].topic).toBe("11111111111141118111111111111111");
    expect(deliveries.map((d) => [d.subscription_id, d.status, d.lateness])).toEqual([
      ["s1", "sent", "on_time"],
      ["s2", "sent", "on_time"],
    ]);
    // Each delivery id and token in the message matches what was recorded (as a hash).
    expect(calls[0].payload.deliveryId).toBe(deliveries[0].id);
    expect(deliveries[0].ack_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(deliveries[0].ack_token_hash).not.toBe(calls[0].payload.ackToken);
    expect(finished).toEqual([{ id: reminder().id, claimId: "c1", update: { next_fire_at: null, status: "completed" } }]);
    expect(subResults).toEqual([{ sent: ["s1", "s2"], failed: [], expired: [] }]);
    expect(s).toMatchObject({ claimed: 1, sent: 2, completed: 1 });
  });

  it("moves a repeating reminder to its next time", async () => {
    const r = reminder({ recurrence: { freq: "daily", interval: 1 } });
    const { store, finished } = fakeStore([r], [sub("s1")]);
    await dispatchDue({ store, send: sender().send, now: at("2026-10-16T04:01:00Z") });
    expect(finished[0].update).toEqual({ next_fire_at: "2026-10-17T04:00:00.000Z", status: "active" });
  });

  it("records 'no_device' honestly when you have not turned on notifications", async () => {
    const { store, deliveries, finished } = fakeStore([reminder()], []);
    const s = await dispatchDue({ store, send: sender().send, now: at("2026-10-16T04:00:10Z") });
    expect(deliveries.map((d) => d.status)).toEqual(["no_device"]);
    expect(finished).toHaveLength(1);
    expect(s.noDevice).toBe(1);
  });

  it("marks late sends as late", async () => {
    const { store, deliveries } = fakeStore([reminder()], [sub("s1")]);
    await dispatchDue({ store, send: sender().send, now: at("2026-10-16T05:00:00Z") });
    expect(deliveries[0]).toMatchObject({ status: "sent", lateness: "late" });
  });

  it("does not send something more than a day late, and records it as missed", async () => {
    const { store, deliveries } = fakeStore([reminder()], [sub("s1")]);
    const { send, calls } = sender();
    await dispatchDue({ store, send, now: at("2026-10-17T05:00:00Z") });
    expect(calls).toHaveLength(0);
    expect(deliveries.map((d) => [d.status, d.lateness])).toEqual([["missed", "missed"]]);
  });

  it("after downtime, sends only the latest occurrence and records older ones as missed", async () => {
    // Daily at 09:00 Karachi; nothing ran from before the 17th until the 19th 09:30.
    const r = reminder({ recurrence: { freq: "daily", interval: 1 }, next_fire_at: "2026-10-17T04:00:00Z" });
    const { store, deliveries, finished } = fakeStore([r], [sub("s1")]);
    const { send, calls } = sender();
    await dispatchDue({ store, send, now: at("2026-10-19T04:30:00Z") });
    expect(calls).toHaveLength(1);
    expect(calls[0].payload.body).toContain("19 Oct");
    expect(deliveries.map((d) => [d.scheduled_for, d.status, d.lateness])).toEqual([
      ["2026-10-19T04:00:00.000Z", "sent", "late"],
      ["2026-10-17T04:00:00.000Z", "missed", "missed"],
      ["2026-10-18T04:00:00.000Z", "missed", "missed"],
    ]);
    expect(finished[0].update.next_fire_at).toBe("2026-10-20T04:00:00.000Z");
  });

  it("removes expired devices and counts failures without stopping", async () => {
    const { store, deliveries, subResults } = fakeStore([reminder(), reminder({ id: "22222222-2222-4222-8222-222222222222", claim_id: "c2" })], [sub("dead"), sub("flaky"), sub("ok")]);
    const { send, calls } = sender({ "https://push.example/dead": "expired", "https://push.example/flaky": "failed" });
    const s = await dispatchDue({ store, send, now: at("2026-10-16T04:00:05Z") });
    // The expired device is not tried again for the second reminder.
    expect(calls.filter((c) => c.target.endpoint.endsWith("dead"))).toHaveLength(1);
    expect(deliveries.filter((d) => d.status === "failed").every((d) => d.error === "boom" && d.ack_token_hash === null)).toBe(true);
    expect(deliveries.find((d) => d.status === "expired")?.subscription_id).toBeNull();
    expect(subResults[0]).toEqual({ sent: ["ok"], failed: ["flaky"], expired: ["dead"] });
    expect(s).toMatchObject({ sent: 2, failed: 2, expired: 1 });
  });

  it("reports when the user edited the reminder mid-run (their edit wins)", async () => {
    const { store } = fakeStore([reminder()], [sub("s1")], { loseClaim: true });
    const s = await dispatchDue({ store, send: sender().send, now: at("2026-10-16T04:00:05Z") });
    expect(s).toMatchObject({ lostClaims: 1, completed: 0 });
  });

  it("keeps going when one reminder is broken", async () => {
    const bad = reminder({ id: "bad", time_zone: "Mars/Olympus" });
    const { store, finished } = fakeStore([bad, reminder()], [sub("s1")]);
    const s = await dispatchDue({ store, send: sender().send, now: at("2026-10-16T04:00:05Z") });
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]).toMatch(/^bad:/);
    expect(finished.map((f) => f.id)).toEqual([reminder().id]);
  });

  it("includes notes in the notification text", async () => {
    const { store } = fakeStore([reminder({ notes: "Two tablets after food" })], [sub("s1")]);
    const { send, calls } = sender();
    await dispatchDue({ store, send, now: at("2026-10-16T04:00:05Z") });
    expect(calls[0].payload.body).toMatch(/^Two tablets after food\n/);
  });
});
