// DispatchStore over Supabase's REST API (PostgREST) with plain fetch, so the
// Edge Function needs no client library. Uses the secret/service-role key,
// which only ever exists inside the Edge Function's environment.

import type { DeliveryRow, DispatchStore, DueReminder, ReminderUpdate, Subscription } from "./dispatch.ts";

export function postgrestStore(supabaseUrl: string, serviceKey: string, doFetch: typeof fetch = fetch): DispatchStore {
  const rest = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };

  async function call(path: string, init: RequestInit & { prefer?: string } = {}): Promise<Response> {
    const res = await doFetch(`${rest}${path}`, {
      ...init,
      headers: { ...headers, ...(init.prefer ? { Prefer: init.prefer } : {}) },
    });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  const inList = (ids: string[]) => `in.(${ids.map((id) => `"${id}"`).join(",")})`;

  return {
    async claimDue(limit) {
      const res = await call("/rpc/claim_due_reminders", { method: "POST", body: JSON.stringify({ p_limit: limit }) });
      return (await res.json()) as DueReminder[];
    },
    async subscriptionsFor(userIds) {
      if (userIds.length === 0) return [];
      const res = await call(`/push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=${inList(userIds)}`);
      return (await res.json()) as Subscription[];
    },
    async recordDeliveries(rows: DeliveryRow[]) {
      if (rows.length === 0) return;
      const body = rows.map((r) => ({ ...r, ack_token_hash: r.ack_token_hash ? `\\x${r.ack_token_hash}` : null }));
      await call("/deliveries", { method: "POST", body: JSON.stringify(body), prefer: "return=minimal" });
    },
    async finish(id: string, claimId: string, update: ReminderUpdate) {
      const res = await call(`/reminders?id=eq.${id}&claim_id=eq.${claimId}&select=id`, {
        method: "PATCH",
        body: JSON.stringify({ ...update, claim_id: null, claimed_until: null }),
        prefer: "return=representation",
      });
      return ((await res.json()) as unknown[]).length === 1;
    },
    async subscriptionResults(sent, failed, expired) {
      const now = new Date().toISOString();
      if (sent.length) await call(`/push_subscriptions?id=${inList(sent)}`, { method: "PATCH", body: JSON.stringify({ last_sent_at: now, failure_count: 0 }), prefer: "return=minimal" });
      if (expired.length) await call(`/push_subscriptions?id=${inList(expired)}`, { method: "DELETE", prefer: "return=minimal" });
      // Failures are counted one by one; there are only ever a few devices.
      for (const id of failed) await call("/rpc/note_push_failure", { method: "POST", body: JSON.stringify({ p_id: id }) });
    },
  };
}
