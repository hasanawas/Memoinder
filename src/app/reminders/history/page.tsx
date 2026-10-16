import type { Metadata } from "next";
import Link from "next/link";
import { History } from "./history";

export const metadata: Metadata = { title: "History · Memoinder" };

export default function HistoryPage() {
  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Delivery history</h1>
        <Link href="/reminders/" className="btn-secondary">
          Back
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        &ldquo;Sent&rdquo; only means the browser&apos;s push service accepted the message. It changes to &ldquo;Shown on
        your device&rdquo; when the device itself confirms it displayed the notification.
      </p>
      <History />
    </main>
  );
}
