import { beforeAll, describe, expect, it } from "vitest";
import { fakeBrowser } from "../support/push-receiver.ts";
import { apiUrl, newUser } from "../support/local-supabase.ts";

// The whole server path with nothing faked: pg_cron (every minute) ->
// pg_net -> the real Edge Function in the local Deno runtime -> database.
// Needs `npx supabase functions serve` running with supabase/functions/.env.
// The device here points at an address that does not exist, so the push
// itself fails; the point is that the scheduled run happened on its own.

const fnUrl = () => `${apiUrl()}/functions/v1/dispatch-reminders`;
let served = false;

beforeAll(async () => {
  const res = await fetch(fnUrl(), { method: "POST" }).catch(() => null);
  served = res?.status === 403; // the function answers, and refuses requests without the secret
  if (!served && process.env.REQUIRE_FUNCTIONS) throw new Error("dispatch-reminders is not being served");
});

async function waitFor<T>(what: string, fn: () => Promise<T | null>, ms = 100_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

describe("scheduled dispatch", () => {
  it("refuses callers without the shared secret", async ({ skip }) => {
    if (!served) skip();
    const res = await fetch(fnUrl(), { method: "POST", headers: { "x-memoinder-secret": "guess" } });
    expect(res.status).toBe(403);
  });

  it("runs by itself within about a minute and records what happened", async ({ skip }) => {
    if (!served) skip();
    const user = await newUser();
    const b = await fakeBrowser();
    await user.client.rpc("save_push_subscription", {
      p_endpoint: `https://push.invalid/${crypto.randomUUID()}`,
      p_p256dh: b.keys.p256dh,
      p_auth: b.keys.auth,
    });
    const { data: r } = await user.client
      .from("reminders")
      .insert({ title: "Cron check", start_local: "2026-10-16T10:00:00", time_zone: "UTC", next_fire_at: new Date().toISOString() })
      .select("id")
      .single();

    const rows = await waitFor("a delivery row", async () => {
      const { data } = await user.client.from("deliveries").select("status,error,lateness").eq("reminder_id", r!.id);
      return data?.length ? data : null;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].lateness).toBe("on_time");
    // Failed on the network (no such host), i.e. after encryption and VAPID signing succeeded in Deno.
    expect(rows[0].error).toMatch(/error sending request|dns|lookup|connect/i);

    const { data: rem } = await user.client.from("reminders").select("status").eq("id", r!.id).single();
    expect(rem!.status).toBe("completed");
  }, 120_000);
});
