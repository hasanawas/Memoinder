// The delivery worker's logic, kept free of Deno, Next.js and Supabase client
// code so it can be unit-tested with fakes. The Edge Function
// (supabase/functions/dispatch-reminders) only wires it to real I/O.

import { advance, classifyDue, DEFAULT_POLICY, scheduleSchema, type DuePolicy } from "../engine/index.ts";
import { b64urlEncode, type PushResult, type PushTarget } from "../push/webpush.ts";

export interface DueReminder {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  start_local: string;
  time_zone: string;
  recurrence: unknown;
  next_fire_at: string;
  claim_id: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type DeliveryStatus = "no_device" | "sent" | "failed" | "expired" | "missed";

export interface DeliveryRow {
  id: string;
  reminder_id: string;
  user_id: string;
  subscription_id: string | null;
  title: string;
  scheduled_for: string;
  lateness: "on_time" | "late" | "missed";
  status: DeliveryStatus;
  http_status: number | null;
  error: string | null;
  /** Hex SHA-256 of the ack token, or null when nothing was sent. */
  ack_token_hash: string | null;
}

export interface ReminderUpdate {
  next_fire_at: string | null;
  status: "active" | "completed";
}

export interface DispatchStore {
  claimDue(limit: number): Promise<DueReminder[]>;
  subscriptionsFor(userIds: string[]): Promise<Subscription[]>;
  recordDeliveries(rows: DeliveryRow[]): Promise<void>;
  /** Applies the update only if the claim is still ours. */
  finish(id: string, claimId: string, update: ReminderUpdate): Promise<boolean>;
  subscriptionResults(sent: string[], failed: string[], expired: string[]): Promise<void>;
}

/** What the Service Worker receives (encrypted) in each push message. */
export interface PushPayload {
  v: 1;
  title: string;
  body: string;
  /** Lets the device acknowledge exactly this delivery. */
  deliveryId: string;
  ackToken: string;
  reminderId: string;
  url: string;
}

export interface DispatchDeps {
  store: DispatchStore;
  send: (target: PushTarget, payload: string, topic: string) => Promise<PushResult>;
  now?: () => Date;
  policy?: DuePolicy;
  batchSize?: number;
  /** Most missed occurrences recorded per reminder per run (avoids huge bursts). */
  maxMissedRows?: number;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  expired: number;
  missed: number;
  noDevice: number;
  completed: number;
  lostClaims: number;
  errors: string[];
}

async function sha256Hex(textValue: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(textValue)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
}

function bodyFor(r: DueReminder, scheduledFor: Date): string {
  const at = new Intl.DateTimeFormat("en-GB", {
    timeZone: r.time_zone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(scheduledFor);
  const notes = r.notes?.trim();
  const text = notes ? `${notes}\n${at}` : `Due ${at}`;
  return text.slice(0, 500);
}

export async function dispatchDue(deps: DispatchDeps): Promise<DispatchSummary> {
  const now = deps.now ?? (() => new Date());
  const policy = deps.policy ?? DEFAULT_POLICY;
  const maxMissed = deps.maxMissedRows ?? 20;
  const summary: DispatchSummary = {
    claimed: 0, sent: 0, failed: 0, expired: 0, missed: 0, noDevice: 0, completed: 0, lostClaims: 0, errors: [],
  };

  const due = await deps.store.claimDue(deps.batchSize ?? 50);
  summary.claimed = due.length;
  if (due.length === 0) return summary;

  const subs = await deps.store.subscriptionsFor([...new Set(due.map((r) => r.user_id))]);
  const subsByUser = new Map<string, Subscription[]>();
  for (const s of subs) subsByUser.set(s.user_id, [...(subsByUser.get(s.user_id) ?? []), s]);
  const expiredSubs = new Set<string>();

  for (const r of due) {
    try {
      // Parse first: a row the engine cannot read is never sent.
      const schedule = scheduleSchema.parse({ start: r.start_local.slice(0, 16), timeZone: r.time_zone, recurrence: r.recurrence });
      const handledAt = now();
      // If the system was down, several occurrences may have passed. Only the
      // most recent one is worth sending; older ones are recorded as missed.
      const { next, skipped } = advance(schedule, new Date(r.next_fire_at), handledAt);
      const past = [new Date(r.next_fire_at), ...skipped];
      const scheduledFor = past[past.length - 1];
      const older = past.slice(0, -1);
      // The database decided it is due; a "pending" here only means this
      // machine's clock is a little behind, so treat it as on time.
      const classified = classifyDue(scheduledFor, handledAt, policy);
      const state = classified === "pending" ? "on_time" : classified;
      const rows: DeliveryRow[] = [];
      const base = { reminder_id: r.id, user_id: r.user_id, title: r.title, scheduled_for: scheduledFor.toISOString() };
      const sent: string[] = [];
      const failed: string[] = [];
      const expired: string[] = [];

      if (state === "missed") {
        rows.push({ ...base, id: crypto.randomUUID(), subscription_id: null, lateness: "missed", status: "missed", http_status: null, error: null, ack_token_hash: null });
        summary.missed++;
      } else {
        const targets = (subsByUser.get(r.user_id) ?? []).filter((s) => !expiredSubs.has(s.id));
        if (targets.length === 0) {
          rows.push({ ...base, id: crypto.randomUUID(), subscription_id: null, lateness: state, status: "no_device", http_status: null, error: null, ack_token_hash: null });
          summary.noDevice++;
        }
        // Same topic for every copy of this reminder: a device that was offline
        // gets the latest one instead of a pile-up.
        const topic = r.id.replace(/-/g, "");
        for (const s of targets) {
          const id = crypto.randomUUID();
          const ackToken = newToken();
          const payload: PushPayload = {
            v: 1,
            title: r.title,
            body: bodyFor(r, scheduledFor),
            deliveryId: id,
            ackToken,
            reminderId: r.id,
            url: "/reminders",
          };
          const result = await deps.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), topic);
          rows.push({
            ...base,
            id,
            subscription_id: result.outcome === "expired" ? null : s.id,
            lateness: state,
            status: result.outcome,
            http_status: result.status,
            error: result.error ? result.error.slice(0, 500) : null,
            ack_token_hash: result.outcome === "sent" ? await sha256Hex(ackToken) : null,
          });
          if (result.outcome === "sent") {
            sent.push(s.id);
            summary.sent++;
          } else if (result.outcome === "expired") {
            expired.push(s.id);
            expiredSubs.add(s.id);
            summary.expired++;
          } else {
            failed.push(s.id);
            summary.failed++;
          }
        }
      }

      for (const at of older.slice(-maxMissed)) {
        rows.push({ ...base, id: crypto.randomUUID(), scheduled_for: at.toISOString(), subscription_id: null, lateness: "missed", status: "missed", http_status: null, error: null, ack_token_hash: null });
        summary.missed++;
      }

      await deps.store.recordDeliveries(rows);
      if (sent.length || failed.length || expired.length) await deps.store.subscriptionResults(sent, failed, expired);
      const update: ReminderUpdate = next ? { next_fire_at: next.toISOString(), status: "active" } : { next_fire_at: null, status: "completed" };
      const ok = await deps.store.finish(r.id, r.claim_id, update);
      if (!ok) summary.lostClaims++;
      else if (!next) summary.completed++;
    } catch (e) {
      // One broken reminder must not block the rest. Its lease expires and it
      // is retried on a later run.
      summary.errors.push(`${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}
