import type { Metadata } from "next";
import { NewForm } from "./new-form";

export const metadata: Metadata = { title: "New reminder · Memoinder" };

export default function NewReminderPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6 md:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">New reminder</h1>
        <p className="text-sm text-muted">Prefer typing it out? The chat understands everyday phrases too.</p>
      </div>
      <div className="card p-5 md:p-6">
        <NewForm />
      </div>
    </main>
  );
}
