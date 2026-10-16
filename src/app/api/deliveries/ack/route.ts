import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseEnv } from "@/lib/supabase/env";

// The Service Worker reports that it showed (or you tapped) a notification.
// There is no session here; the one-time token from the push message is the
// proof, and the database function checks it against the stored hash.

const body = z.object({
  id: z.uuid(),
  token: z.string().min(16).max(100),
  event: z.enum(["displayed", "clicked"]),
});

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
  const { url, key } = supabaseEnv();
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("ack_delivery", {
    p_id: parsed.data.id,
    p_token: parsed.data.token,
    p_event: parsed.data.event,
  });
  if (error) return Response.json({ ok: false }, { status: 500 });
  return Response.json({ ok: data === true }, { status: data === true ? 200 : 404 });
}
