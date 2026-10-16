import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { recentDeliveries } from "@/lib/push/data";
import { statusLabel } from "@/lib/push/status";

export const metadata: Metadata = { title: "History · Memoinder" };

export default function HistoryPage() {
  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Delivery history</h1>
        <Link href="/reminders" className="btn-secondary">
          Back
        </Link>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        &ldquo;Sent&rdquo; only means the browser&apos;s push service accepted the message. It changes to &ldquo;Shown on
        your device&rdquo; when the device itself confirms it displayed the notification.
      </p>
      <Suspense fallback={<p className="text-zinc-500">Loading history…</p>}>
        <History />
      </Suspense>
    </main>
  );
}

async function History() {
  const rows = await recentDeliveries(100);
  if (rows.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">Nothing has been due yet.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Deliveries">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex justify-between gap-3">
            <span className="font-medium">{d.title}</span>
            <span className="text-zinc-500">{DateTime.fromISO(d.scheduled_for, { zone: d.reminder?.time_zone ?? "UTC" }).toFormat("ccc d LLL, HH:mm")}</span>
          </div>
          <span>{statusLabel(d)}</span>
          {d.status === "failed" && d.error && (
            <span className="text-xs text-zinc-500">
              {d.http_status ? `HTTP ${d.http_status}: ` : ""}
              {d.error}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
