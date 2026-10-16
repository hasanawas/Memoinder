"use client";

import { useSearchParams } from "next/navigation";
import { ReminderForm } from "@/components/reminder-form";
import { getReminder } from "@/lib/reminders/data";
import { rowToFormValues } from "@/lib/reminders/form";
import { useLoad } from "@/lib/use-load";
import { updateReminderAction } from "../actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function EditForm() {
  const id = useSearchParams().get("id") ?? "";
  // Postgres rejects a malformed uuid with an error; treat it as not found.
  const row = useLoad(() => (UUID.test(id) ? getReminder(id) : Promise.resolve(null)));

  if (row.loading) return <p className="text-muted">Loading…</p>;
  if (row.error) return <p role="alert">{row.error}</p>;
  if (!row.data) return <p>That reminder does not exist (or is not yours).</p>;
  return <ReminderForm action={updateReminderAction.bind(null, id)} initial={rowToFormValues(row.data)} submitLabel="Save changes" />;
}
