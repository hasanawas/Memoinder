"use client";

import { DateTime } from "luxon";
import { recentDeliveries } from "@/lib/push/data";
import { statusLabel } from "@/lib/push/status";
import { useLoad } from "@/lib/use-load";

export function History() {
  const list = useLoad(() => recentDeliveries(100));
  if (list.loading) return <p className="text-zinc-500">Loading history…</p>;
  if (list.error) return <p role="alert">{list.error}</p>;
  const rows = list.data!;
  if (rows.length === 0) return <p className="text-zinc-600 dark:text-zinc-400">Nothing has been due yet.</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label="Deliveries">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="flex justify-between gap-3">
            <span className="font-medium">{d.title}</span>
            <span className="text-zinc-500">
              {DateTime.fromISO(d.scheduled_for, { zone: d.reminder?.time_zone ?? "UTC" }).toFormat("ccc d LLL, HH:mm")}
            </span>
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
