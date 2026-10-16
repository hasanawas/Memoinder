import { requireUser } from "@/lib/reminders/data";

// Data access for devices (push subscriptions) and delivery history. Row
// Level Security limits every query to the signed-in user's rows.

export interface DeliveryView {
  id: string;
  reminder_id: string;
  title: string;
  scheduled_for: string;
  lateness: "on_time" | "late" | "missed" | null;
  status: "no_device" | "sent" | "failed" | "expired" | "missed" | "displayed" | "clicked";
  http_status: number | null;
  error: string | null;
  created_at: string;
  displayed_at: string | null;
  clicked_at: string | null;
  reminder: { time_zone: string } | null;
}

const DELIVERY_COLUMNS = "id,reminder_id,title,scheduled_for,lateness,status,http_status,error,created_at,displayed_at,clicked_at,reminder:reminders(time_zone)";

export async function countDevices(): Promise<number> {
  const { supabase } = await requireUser();
  const { count, error } = await supabase.from("push_subscriptions").select("id", { count: "exact", head: true });
  if (error) throw new Error(`Could not load devices: ${error.message}`);
  return count ?? 0;
}

export async function saveSubscription(endpoint: string, p256dh: string, auth: string, userAgent: string | null) {
  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: userAgent,
  });
  if (error) throw new Error(`Could not save this device: ${error.message}`);
}

export async function removeSubscription(endpoint: string) {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) throw new Error(`Could not remove this device: ${error.message}`);
}

export async function recentDeliveries(limit = 50): Promise<DeliveryView[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("deliveries")
    .select(DELIVERY_COLUMNS)
    .order("created_at", { ascending: false })
    .order("scheduled_for", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load delivery history: ${error.message}`);
  return data as unknown as DeliveryView[];
}

/** The best status per reminder for its latest occurrence (any device). */
export async function latestDeliveryByReminder(): Promise<Map<string, DeliveryView>> {
  const rows = await recentDeliveries(200);
  const rank: Record<DeliveryView["status"], number> = {
    clicked: 6, displayed: 5, sent: 4, failed: 3, expired: 2, no_device: 1, missed: 0,
  };
  const latest = new Map<string, DeliveryView>();
  for (const d of rows) {
    const cur = latest.get(d.reminder_id);
    if (!cur || d.scheduled_for > cur.scheduled_for || (d.scheduled_for === cur.scheduled_for && rank[d.status] > rank[cur.status])) {
      latest.set(d.reminder_id, d);
    }
  }
  return latest;
}
