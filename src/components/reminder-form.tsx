"use client";

import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { FormValues } from "@/lib/reminders/form";
import type { ReminderFormState } from "@/app/reminders/actions";

const WEEKDAY_LABELS = [
  ["MO", "Mon"],
  ["TU", "Tue"],
  ["WE", "Wed"],
  ["TH", "Thu"],
  ["FR", "Fri"],
  ["SA", "Sat"],
  ["SU", "Sun"],
] as const;

const noopSubscribe = () => () => {};

function browserZones(): string[] {
  const all = Intl.supportedValuesOf("timeZone");
  return all.includes("UTC") ? all : ["UTC", ...all];
}

type Action = (prev: ReminderFormState, fd: FormData) => Promise<ReminderFormState>;

export function ReminderForm({
  action,
  initial,
  submitLabel,
}: {
  action: Action;
  initial: FormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, { attempt: 0 });
  const router = useRouter();
  useEffect(() => {
    if (state.saved) router.push("/reminders/");
  }, [state.saved, router]);
  // React resets a form after its action runs; re-mounting with the submitted
  // values keeps what the user typed when there are errors to fix.
  return (
    <Fields
      key={state.attempt}
      values={state.values ?? initial}
      errors={state.errors ?? {}}
      formAction={formAction}
      pending={pending || Boolean(state.saved)}
      submitLabel={submitLabel}
    />
  );
}

function Fields({
  values,
  errors,
  formAction,
  pending,
  submitLabel,
}: {
  values: FormValues;
  errors: NonNullable<ReminderFormState["errors"]>;
  formAction: (fd: FormData) => void;
  pending: boolean;
  submitLabel: string;
}) {
  const [repeat, setRepeat] = useState(values.repeat);
  const [end, setEnd] = useState(values.end);
  const [chosenZone, setChosenZone] = useState(values.timeZone);
  // The zone list and the browser's own zone exist only on the client, so the
  // server renders just the saved zone and the browser fills in the rest.
  const onClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const ownZone = onClient ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const timeZone = chosenZone || ownZone;
  const zones = onClient ? browserZones() : [timeZone].filter(Boolean);

  const err = (k: keyof FormValues) =>
    errors[k] ? (
      <span role="alert" className="text-sm text-red-700 dark:text-red-400">
        {errors[k]}
      </span>
    ) : null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Title</span>
        <input name="title" required maxLength={200} defaultValue={values.title} className="field" />
        {err("title")}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Notes (optional)</span>
        <textarea name="notes" rows={2} maxLength={2000} defaultValue={values.notes} className="field" />
        {err("notes")}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Date</span>
          <input name="date" type="date" required defaultValue={values.date} className="field" />
          {err("date")}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Time</span>
          <input name="time" type="time" required defaultValue={values.time} className="field" />
          {err("time")}
        </label>
      </div>

      <div className="flex flex-col gap-1">
        {/* A separate label: wrapping a select would put every option in its name. */}
        <label htmlFor="timeZone" className="text-sm font-medium">
          Time zone
        </label>
        <select id="timeZone" name="timeZone" value={timeZone} onChange={(e) => setChosenZone(e.target.value)} className="field">
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
        {err("timeZone")}
      </div>

      <fieldset className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <legend className="px-1 text-sm font-medium">Repeat</legend>
        <div className="flex flex-wrap items-center gap-3">
          <select
            name="repeat"
            aria-label="Repeat"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value as FormValues["repeat"])}
            className="field"
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
          {repeat !== "none" && (
            <label className="flex items-center gap-2 text-sm">
              every
              <input
                name="interval"
                type="number"
                min={1}
                max={999}
                defaultValue={values.interval}
                aria-label="Interval"
                className="field w-20"
              />
              {{ daily: "day(s)", weekly: "week(s)", monthly: "month(s)", yearly: "year(s)" }[repeat]}
            </label>
          )}
        </div>
        {err("repeat")}
        {err("interval")}

        {repeat === "weekly" && (
          <div className="flex flex-wrap gap-3" role="group" aria-label="Weekdays">
            {WEEKDAY_LABELS.map(([code, label]) => (
              <label key={code} className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="weekdays" value={code} defaultChecked={values.weekdays.includes(code)} />
                {label}
              </label>
            ))}
            <span className="w-full text-xs text-zinc-500">None ticked means the start date&apos;s weekday.</span>
          </div>
        )}

        {repeat !== "none" && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select
              name="end"
              aria-label="Ends"
              value={end}
              onChange={(e) => setEnd(e.target.value as FormValues["end"])}
              className="field"
            >
              <option value="never">Never ends</option>
              <option value="until">Ends on a date</option>
              <option value="count">Ends after a number of times</option>
            </select>
            {end === "until" && (
              <input name="until" type="date" aria-label="End date" defaultValue={values.until} className="field" />
            )}
            {end === "count" && (
              <input
                name="count"
                type="number"
                min={1}
                max={1000}
                aria-label="Number of times"
                defaultValue={values.count}
                className="field w-24"
              />
            )}
          </div>
        )}
        {err("until")}
        {err("count")}
      </fieldset>

      {errors.form && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {errors.form}
        </p>
      )}

      <div>
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
