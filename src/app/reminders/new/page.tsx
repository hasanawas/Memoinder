import type { Metadata } from "next";
import { ReminderForm } from "@/components/reminder-form";
import { emptyFormValues } from "@/lib/reminders/form";
import { createReminderAction } from "../actions";

export const metadata: Metadata = { title: "New reminder · Memoinder" };

export default function NewReminderPage() {
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New reminder</h1>
      <ReminderForm action={createReminderAction} initial={emptyFormValues("")} submitLabel="Save reminder" />
    </main>
  );
}
