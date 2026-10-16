import { z } from "zod";
import {
  WEEKDAYS,
  nextOccurrence,
  scheduleSchema,
  toRRuleString,
  type Recurrence,
  type Schedule,
} from "@/lib/engine";

// Turns the reminder form's fields into an engine Schedule and a database row,
// and back again for the edit screen. Kept free of Next.js and Supabase so it
// can be unit-tested directly.

export type FieldErrors = Partial<Record<keyof FormValues | "form", string>>;

export interface FormValues {
  title: string;
  notes: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  timeZone: string;
  repeat: "none" | Recurrence["freq"];
  interval: string;
  weekdays: string[];
  end: "never" | "until" | "count";
  until: string;
  count: string;
}

export interface ReminderDraft {
  title: string;
  notes: string | null;
  schedule: Schedule;
}

/** Shape of a row in public.reminders (only the columns the app writes). */
export interface ReminderRowInput {
  title: string;
  notes: string | null;
  start_local: string;
  time_zone: string;
  recurrence: Recurrence | null;
  rrule: string | null;
  next_fire_at: string;
  status: "active";
}

export interface ReminderRow extends Omit<ReminderRowInput, "next_fire_at" | "status"> {
  id: string;
  next_fire_at: string | null;
  status: "active" | "completed";
  created_at: string;
  updated_at: string;
}

const formSchema = z.object({
  title: z.string().trim().min(1, "Give the reminder a title").max(200, "Keep the title under 200 characters"),
  notes: z.string().trim().max(2000, "Keep notes under 2000 characters"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Pick a time"),
  timeZone: z.string().min(1, "Pick a time zone"),
  repeat: z.enum(["none", "daily", "weekly", "monthly", "yearly"]),
  interval: z.coerce.number().int("Use a whole number").min(1, "At least 1").max(999, "At most 999"),
  weekdays: z.array(z.enum(WEEKDAYS)),
  end: z.enum(["never", "until", "count"]),
  until: z.string(),
  count: z.string(),
});

export function readForm(fd: FormData): FormValues {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    title: s("title"),
    notes: s("notes"),
    date: s("date"),
    time: s("time"),
    timeZone: s("timeZone"),
    repeat: (s("repeat") || "none") as FormValues["repeat"],
    interval: s("interval") || "1",
    weekdays: fd.getAll("weekdays").map(String),
    end: (s("end") || "never") as FormValues["end"],
    until: s("until"),
    count: s("count"),
  };
}

export type ParseResult = { ok: true; draft: ReminderDraft } | { ok: false; errors: FieldErrors };

export function parseForm(values: FormValues): ParseResult {
  const base = formSchema.safeParse(values);
  if (!base.success) {
    const errors: FieldErrors = {};
    for (const issue of base.error.issues) {
      const key = issue.path[0] as keyof FormValues;
      errors[key] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const v = base.data;

  let recurrence: Recurrence | null = null;
  if (v.repeat !== "none") {
    recurrence = { freq: v.repeat, interval: v.interval };
    if (v.repeat === "weekly" && v.weekdays.length > 0) recurrence.weekdays = v.weekdays;
    if (v.end === "until") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.until)) return { ok: false, errors: { until: "Pick an end date" } };
      recurrence.until = v.until;
    }
    if (v.end === "count") {
      const n = Number(v.count);
      if (!Number.isInteger(n) || n < 1 || n > 1000)
        return { ok: false, errors: { count: "Use a whole number from 1 to 1000" } };
      recurrence.count = n;
    }
  }

  const schedule = scheduleSchema.safeParse({
    start: `${v.date}T${v.time}`,
    timeZone: v.timeZone,
    recurrence,
  });
  if (!schedule.success) {
    const issue = schedule.error.issues[0];
    const field: keyof FormValues =
      issue.path[0] === "timeZone"
        ? "timeZone"
        : issue.path[0] === "start"
          ? "date"
          : issue.message.includes("until")
            ? "until"
            : "repeat";
    return { ok: false, errors: { [field]: issue.message } };
  }

  return { ok: true, draft: { title: v.title, notes: v.notes || null, schedule: schedule.data } };
}

export type RowResult = { ok: true; row: ReminderRowInput } | { ok: false; errors: FieldErrors };

/** Builds the row to save, computing the next notification time from `now`. */
export function draftToRow(draft: ReminderDraft, now: Date): RowResult {
  const next = nextOccurrence(draft.schedule, now);
  if (!next) {
    return {
      ok: false,
      errors: {
        date: draft.schedule.recurrence
          ? "This repeat has no times left after now"
          : "That time has already passed",
      },
    };
  }
  return {
    ok: true,
    row: {
      title: draft.title,
      notes: draft.notes,
      start_local: `${draft.schedule.start}:00`,
      time_zone: draft.schedule.timeZone,
      recurrence: draft.schedule.recurrence,
      rrule: toRRuleString(draft.schedule),
      next_fire_at: next.toISOString(),
      status: "active",
    },
  };
}

export function rowToSchedule(row: Pick<ReminderRow, "start_local" | "time_zone" | "recurrence">): Schedule {
  return scheduleSchema.parse({
    start: row.start_local.slice(0, 16),
    timeZone: row.time_zone,
    recurrence: row.recurrence,
  });
}

export function rowToFormValues(row: ReminderRow): FormValues {
  const r = row.recurrence;
  return {
    title: row.title,
    notes: row.notes ?? "",
    date: row.start_local.slice(0, 10),
    time: row.start_local.slice(11, 16),
    timeZone: row.time_zone,
    repeat: r?.freq ?? "none",
    interval: String(r?.interval ?? 1),
    weekdays: r?.weekdays ?? [],
    end: r?.until ? "until" : r?.count ? "count" : "never",
    until: r?.until ?? "",
    count: r?.count ? String(r.count) : "",
  };
}

export function emptyFormValues(timeZone: string): FormValues {
  return {
    title: "",
    notes: "",
    date: "",
    time: "",
    timeZone,
    repeat: "none",
    interval: "1",
    weekdays: [],
    end: "never",
    until: "",
    count: "",
  };
}
