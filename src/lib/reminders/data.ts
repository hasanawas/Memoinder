import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ReminderRow, ReminderRowInput } from "./form";

// Data access layer: the only place that reads or writes reminders. Every
// function re-checks the session, and the database's Row Level Security
// policies limit each query to the signed-in user's own rows.

export async function requireUser() {
  // Checking the session compares token expiry with the clock, and pages use
  // the current time too, so this must run per request, never at build time.
  await connection();
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  return { supabase, userId: claims.sub, email: (claims.email as string | undefined) ?? "" };
}

const COLUMNS = "id,title,notes,start_local,time_zone,recurrence,rrule,next_fire_at,status,created_at,updated_at";

export async function listReminders(): Promise<ReminderRow[]> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("reminders")
    .select(COLUMNS)
    .order("next_fire_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Could not load reminders: ${error.message}`);
  return data as ReminderRow[];
}

export async function getReminder(id: string): Promise<ReminderRow | null> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("reminders").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load reminder: ${error.message}`);
  return data as ReminderRow | null;
}

export async function insertReminder(row: ReminderRowInput): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("reminders").insert(row);
  if (error) throw new Error(`Could not save reminder: ${error.message}`);
}

/** Returns false when no row was changed (missing, or not this user's). */
export async function updateReminder(id: string, row: ReminderRowInput): Promise<boolean> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("reminders").update(row).eq("id", id).select("id");
  if (error) throw new Error(`Could not update reminder: ${error.message}`);
  return data.length > 0;
}

export async function deleteReminder(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("reminders").delete().eq("id", id);
  if (error) throw new Error(`Could not delete reminder: ${error.message}`);
}
