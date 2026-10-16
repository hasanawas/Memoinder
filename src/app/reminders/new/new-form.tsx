"use client";

import { ReminderForm } from "@/components/reminder-form";
import { emptyFormValues } from "@/lib/reminders/form";
import { createReminderAction } from "../actions";

export function NewForm() {
  return <ReminderForm action={createReminderAction} initial={emptyFormValues("")} submitLabel="Save reminder" />;
}
