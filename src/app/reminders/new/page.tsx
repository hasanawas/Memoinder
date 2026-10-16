import type { Metadata } from "next";
import { NewForm } from "./new-form";

export const metadata: Metadata = { title: "New reminder · Memoinder" };

export default function NewReminderPage() {
  return (
    <main className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">New reminder</h1>
      <NewForm />
    </main>
  );
}
