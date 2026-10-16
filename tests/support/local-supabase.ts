// Test-only helpers for the local Supabase started by `npx supabase start`.
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: Record<string, string> | null = null;

/** Values from `supabase status`, e.g. SERVICE_ROLE_KEY. Never use against a hosted project. */
export function localStatus(): Record<string, string> {
  if (cached) return cached;
  const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  cached = Object.fromEntries(
    out
      .split("\n")
      .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1], m[2]]),
  );
  return cached;
}

export const apiUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? localStatus().API_URL;
export const publishableKey = () => process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? localStatus().PUBLISHABLE_KEY;
/** The legacy service-role JWT, the same credential the Edge Function receives. */
export const serviceRoleKey = () => localStatus().SERVICE_ROLE_KEY;

export function anonClient(): SupabaseClient {
  return createClient(apiUrl(), publishableKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function newUser(email = `t-${crypto.randomUUID()}@example.test`, password = "correct-horse-battery") {
  const c = anonClient();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw error;
  return { client: c, userId: data.user!.id, email, password };
}

/**
 * pg_cron starts the real dispatcher at the top of every minute. Tests that
 * run the dispatcher themselves wait until they are clear of that moment so
 * the two do not race for the same reminder.
 */
export async function awayFromMinuteBoundary() {
  for (;;) {
    const s = new Date().getUTCSeconds();
    if (s >= 8 && s <= 45) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}
