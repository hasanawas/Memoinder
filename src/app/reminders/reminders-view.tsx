"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { describeSchedule, upcoming } from "@/lib/engine";
import { listReminders } from "@/lib/reminders/data";
import { rowToSchedule, type ReminderRow } from "@/lib/reminders/form";
import { countDevices, latestDeliveryByReminder, type DeliveryView } from "@/lib/push/data";
import { statusLabel } from "@/lib/push/status";
import { useLoad } from "@/lib/use-load";
import { NotificationsPanel } from "@/components/notifications-panel";
import { deleteReminderAction } from "./actions";

export function RemindersView() {
  const list = useLoad(async () => {
    const [rows, deliveries, devices] = await Promise.all([listReminders(), latestDeliveryByReminder(), countDevices()]);
    return { rows, deliveries, devices };
  });

  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Upcoming</h1>
        <div className="flex gap-2">
          <Link href="/reminders/history/" className="btn-secondary">
            History
          </Link>
          <Link href="/reminders/chat/" className="btn-secondary">
            Chat
          </Link>
          <Link href="/reminders/new/" className="btn-primary">
            New reminder
          </Link>
        </div>
      </div>
      {list.data && (
        <NotificationsPanel
          vapidPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
          deviceCount={list.data.devices}
          onChange={list.reload}
        />
      )}
      {list.loading && <p className="text-zinc-500">Loading reminders…</p>}
      {list.error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {list.error}
        </p>
      )}
      {list.data && <ReminderList rows={list.data.rows} deliveries={list.data.deliveries} onChange={list.reload} />}
    </main>
  );
}

function when(iso: string, zone: string) {
  return DateTime.fromISO(iso, { zone }).toFormat("ccc d LLL yyyy, HH:mm");
}

function ReminderList({
  rows,
  deliveries,
  onChange,
}: {
  rows: ReminderRow[];
  deliveries: Map<string, DeliveryView>;
  onChange: () => void;
}) {
  const active = rows.filter((r) => r.status === "active");
  const finished = rows.filter((r) => r.status !== "active");

  if (rows.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">No reminders yet. Create your first one.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-3" aria-label="Upcoming reminders">
        {active.map((r) => (
          <ReminderItem key={r.id} row={r} last={deliveries.get(r.id)} onChange={onChange} />
        ))}
      </ul>
      {finished.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Finished</h2>
          <ul className="flex flex-col gap-3" aria-label="Finished reminders">
            {finished.map((r) => (
              <ReminderItem key={r.id} row={r} last={deliveries.get(r.id)} onChange={onChange} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ReminderItem({ row, last, onChange }: { row: ReminderRow; last?: DeliveryView; onChange: () => void }) {
  const schedule = rowToSchedule(row);
  const later = row.next_fire_at ? upcoming(schedule, new Date(row.next_fire_at), 2) : [];
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{row.title}</h3>
          {row.notes && <p className="text-sm text-zinc-600 dark:text-zinc-400">{row.notes}</p>}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/reminders/edit/?id=${row.id}`} className="btn-secondary">
            Edit
          </Link>
          <button
            className="btn-secondary"
            aria-label={`Delete ${row.title}`}
            onClick={async () => {
              await deleteReminderAction(row.id);
              onChange();
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <p className="text-sm">
        {row.next_fire_at ? (
          <>
            Next: <strong>{when(row.next_fire_at, row.time_zone)}</strong>
            {later.length > 0 && (
              <span className="text-zinc-500"> · then {later.map((d) => when(d.toISOString(), row.time_zone)).join(", ")}</span>
            )}
          </>
        ) : (
          "No more times"
        )}
      </p>
      <p className="text-xs text-zinc-500">{describeSchedule(schedule)}</p>
      {last && (
        <p className="text-xs" data-testid="last-delivery">
          Last reminder ({when(last.scheduled_for, row.time_zone)}): {statusLabel(last)}
        </p>
      )}
    </li>
  );
}
