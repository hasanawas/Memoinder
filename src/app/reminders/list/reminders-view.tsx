"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { describeSchedule, upcoming } from "@/lib/engine";
import { listReminders } from "@/lib/reminders/data";
import { rowToSchedule, type ReminderRow } from "@/lib/reminders/form";
import { latestDeliveryByReminder, type DeliveryView } from "@/lib/push/data";
import { statusLabel } from "@/lib/push/status";
import { useLoad } from "@/lib/use-load";
import { ClockIcon, PenIcon, PlusIcon, RepeatIcon, TrashIcon } from "@/components/icons";
import { deleteReminderAction } from "../actions";

export function RemindersView() {
  const list = useLoad(async () => {
    const [rows, deliveries] = await Promise.all([listReminders(), latestDeliveryByReminder()]);
    return { rows, deliveries };
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Reminders</h1>
          <p className="text-sm text-muted">Everything you have scheduled, soonest first.</p>
        </div>
        <Link href="/reminders/new/" className="btn-primary">
          <PlusIcon /> New reminder
        </Link>
      </div>
      {list.loading && <p className="text-muted">Loading reminders…</p>}
      {list.error && (
        <p role="alert" className="text-sm text-danger">
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
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
        <ClockIcon width={28} height={28} className="text-muted" />
        <p className="font-medium">No reminders yet. Create your first one.</p>
        <p className="text-sm text-muted">
          Use <Link href="/reminders/" className="text-accent hover:underline">the chat</Link> (&ldquo;remind me to water
          the plants every Sunday at 10&rdquo;) or the New reminder form.
        </p>
      </div>
    );
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
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Finished</h2>
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
  const repeats = Boolean(row.recurrence);
  return (
    <li className={`card group flex gap-4 p-4 transition hover:border-accent/40 ${row.status === "active" ? "" : "opacity-75"}`}>
      <span
        aria-hidden
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"
      >
        {repeats ? <RepeatIcon /> : <ClockIcon />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-medium">{row.title}</h3>
            {row.notes && <p className="text-sm text-muted">{row.notes}</p>}
          </div>
          <div className="flex shrink-0 gap-1">
            <Link href={`/reminders/edit/?id=${row.id}`} className="btn-ghost px-2.5 py-1.5">
              <PenIcon width={16} height={16} />
              Edit
            </Link>
            <button
              className="btn-ghost px-2.5 py-1.5 hover:text-danger"
              aria-label={`Delete ${row.title}`}
              onClick={async () => {
                await deleteReminderAction(row.id);
                onChange();
              }}
            >
              <TrashIcon width={16} height={16} />
            </button>
          </div>
        </div>
        <p className="text-sm">
          {row.next_fire_at ? (
            <>
              Next: <strong>{when(row.next_fire_at, row.time_zone)}</strong>
              {later.length > 0 && (
                <span className="text-muted"> · then {later.map((d) => when(d.toISOString(), row.time_zone)).join(", ")}</span>
              )}
            </>
          ) : (
            "No more times"
          )}
        </p>
        <p className="text-xs text-muted">{describeSchedule(schedule)}</p>
        {last && (
          <p className="text-xs text-muted" data-testid="last-delivery">
            Last reminder ({when(last.scheduled_for, row.time_zone)}): {statusLabel(last)}
          </p>
        )}
      </div>
    </li>
  );
}
