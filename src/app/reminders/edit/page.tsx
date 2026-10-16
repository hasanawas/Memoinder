import { Suspense } from "react";
import type { Metadata } from "next";
import { EditForm } from "./edit-form";

export const metadata: Metadata = { title: "Edit reminder · Memoinder" };

// A static site cannot have one page per reminder id, so the id travels in
// the query string: /reminders/edit/?id=...
export default function EditReminderPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Edit reminder</h1>
      <div className="card p-5 md:p-6">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <EditForm />
        </Suspense>
      </div>
    </main>
  );
}
