import { Suspense } from "react";
import type { Metadata } from "next";
import { EditForm } from "./edit-form";

export const metadata: Metadata = { title: "Edit reminder · Memoinder" };

// A static site cannot have one page per reminder id, so the id travels in
// the query string: /reminders/edit/?id=...
export default function EditReminderPage() {
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Edit reminder</h1>
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <EditForm />
      </Suspense>
    </main>
  );
}
