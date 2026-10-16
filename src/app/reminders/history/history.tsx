"use client";

import { DateTime } from "luxon";
import { recentDeliveries } from "@/lib/push/data";
import { statusLabel } from "@/lib/push/status";
import { useLoad } from "@/lib/use-load";

export function History() {
  const list = useLoad(() => recentDeliveries(100));
  if (list.loading) return <p className="text-muted">Loading history…</p>;
  if (list.error) return <p role="alert">{list.error}</p>;
  const rows = list.data!;
  if (rows.length === 0) return <div className="card px-6 py-12 text-center text-muted">Nothing has been due yet.</div>;
  return (
    <ul className="card flex flex-col divide-y divide-line" aria-label="Deliveries">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
          <div className="flex justify-between gap-3">
            <span className="font-medium">{d.title}</span>
            <span className="text-muted">
              {DateTime.fromISO(d.scheduled_for, { zone: d.reminder?.time_zone ?? "UTC" }).toFormat("ccc d LLL, HH:mm")}
            </span>
          </div>
          <span>{statusLabel(d)}</span>
          {d.status === "failed" && d.error && (
            <span className="text-xs text-muted">
              {d.http_status ? `HTTP ${d.http_status}: ` : ""}
              {d.error}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
