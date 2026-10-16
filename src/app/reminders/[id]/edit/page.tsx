import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReminderForm } from "@/components/reminder-form";
import { getReminder } from "@/lib/reminders/data";
import { rowToFormValues } from "@/lib/reminders/form";
import { updateReminderAction } from "../../actions";

export const metadata: Metadata = { title: "Edit reminder · Memoinder" };

export default function EditReminderPage({ params }: PageProps<"/reminders/[id]/edit">) {
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Edit reminder</h1>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <EditForm params={params} />
      </Suspense>
    </main>
  );
}

async function EditForm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Postgres rejects a malformed uuid with an error; treat it as not found.
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await getReminder(id);
  if (!row) notFound();
  return (
    <ReminderForm
      action={updateReminderAction.bind(null, id)}
      initial={rowToFormValues(row)}
      submitLabel="Save changes"
    />
  );
}
