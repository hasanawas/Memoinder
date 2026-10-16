import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { DateTime } from "luxon";
import { describeSchedule, upcoming } from "@/lib/engine";
import { listReminders } from "@/lib/reminders/data";
import { rowToSchedule, type ReminderRow } from "@/lib/reminders/form";
import { deleteReminderAction } from "./actions";

export const metadata: Metadata = { title: "Reminders · Memoinder" };

export default function RemindersPage() {
  return (
    <main className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Upcoming</h1>
        <Link href="/reminders/new" className="btn-primary">
          New reminder
        </Link>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Loading reminders…</p>}>
        <ReminderList />
      </Suspense>
    </main>
  );
}

function when(iso: string, zone: string) {
  return DateTime.fromISO(iso, { zone }).toFormat("ccc d LLL yyyy, HH:mm");
}

async function ReminderList() {
  const rows = await listReminders();
  const active = rows.filter((r) => r.status === "active");
  const finished = rows.filter((r) => r.status !== "active");

  if (rows.length === 0) {
    return <p className="text-zinc-600 dark:text-zinc-400">No reminders yet. Create your first one.</p>;
  }
  return (
    <>
      <ul className="flex flex-col gap-3" aria-label="Upcoming reminders">
        {active.map((r) => (
          <ReminderItem key={r.id} row={r} />
        ))}
      </ul>
      {finished.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Finished</h2>
          <ul className="flex flex-col gap-3" aria-label="Finished reminders">
            {finished.map((r) => (
              <ReminderItem key={r.id} row={r} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ReminderItem({ row }: { row: ReminderRow }) {
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
          <Link href={`/reminders/${row.id}/edit`} className="btn-secondary">
            Edit
          </Link>
          <form action={deleteReminderAction.bind(null, row.id)}>
            <button className="btn-secondary" aria-label={`Delete ${row.title}`}>
              Delete
            </button>
          </form>
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
    </li>
  );
}
