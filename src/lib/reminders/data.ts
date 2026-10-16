import { supabase as client } from "@/lib/supabase/client";
import type { ReminderRow, ReminderRowInput } from "./form";
import { remindersChanged } from "@/lib/events";

// Data access layer: the only place that reads or writes reminders. It runs
// in the browser, so it is a convenience, not a security boundary: the
// database's Row Level Security policies and checks are what limit each query
// to the signed-in user's own, valid rows.

export class NotSignedInError extends Error {
  constructor() {
    super("You are signed out. Sign in again to continue.");
  }
}

export async function requireUser() {
  const supabase = client();
  // getSession() reads the stored session (refreshing it if needed); the
  // database still verifies the token on every request.
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) throw new NotSignedInError();
  return { supabase, userId: user.id, email: user.email ?? "" };
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

/** Returns the new reminder's id. */
export async function insertReminder(row: ReminderRowInput): Promise<string> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("reminders").insert(row).select("id").single();
  if (error) throw new Error(`Could not save reminder: ${error.message}`);
  remindersChanged();
  return data.id as string;
}

/** Returns false when no row was changed (missing, or not this user's). */
export async function updateReminder(id: string, row: ReminderRowInput): Promise<boolean> {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.from("reminders").update(row).eq("id", id).select("id");
  if (error) throw new Error(`Could not update reminder: ${error.message}`);
  remindersChanged();
  return data.length > 0;
}

export async function deleteReminder(id: string): Promise<void> {
  const { supabase } = await requireUser();
  const { error } = await supabase.from("reminders").delete().eq("id", id);
  if (error) throw new Error(`Could not delete reminder: ${error.message}`);
  remindersChanged();
}
