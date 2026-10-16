// Edge Function: sends the reminders that are due. Called once a minute by
// pg_cron (see supabase/migrations/*_push.sql), only when something is due.
// All the logic lives in src/lib/dispatch so it can be tested without Deno.

import { dispatchDue } from "../../../src/lib/dispatch/dispatch.ts";
import { postgrestStore } from "../../../src/lib/dispatch/postgrest-store.ts";
import { sendPush, type VapidKeys } from "../../../src/lib/push/webpush.ts";

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

/** Compares secrets without leaking how many characters matched. */
function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let secret: string, vapid: VapidKeys, store;
  try {
    secret = env("MEMOINDER_DISPATCH_SECRET");
    vapid = { publicKey: env("VAPID_PUBLIC_KEY"), privateKey: env("VAPID_PRIVATE_KEY"), subject: env("VAPID_SUBJECT") };
    store = postgrestStore(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
  } catch (e) {
    console.error(String(e));
    return Response.json({ error: "Dispatcher is not configured" }, { status: 500 });
  }
  if (!sameSecret(req.headers.get("x-memoinder-secret") ?? "", secret)) {
    return new Response("Forbidden", { status: 403 });
  }

  const started = Date.now();
  const summary = await dispatchDue({
    store,
    // 24 h matches the "missed after a day" rule: an offline device that comes
    // back later than that would only get a stale reminder.
    send: (target, payload, topic) => sendPush(target, payload, vapid, { ttl: 24 * 60 * 60, urgency: "high", topic }),
  });
  const result = { ...summary, ms: Date.now() - started };
  if (summary.claimed > 0) console.log(JSON.stringify(result));
  return Response.json(result, { status: summary.errors.length ? 207 : 200 });
});
