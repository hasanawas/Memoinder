import { DateTime, IANAZone } from "luxon";
import { z } from "zod";

// A reminder's schedule, as the user thinks about it: a wall-clock time in a
// named time zone, plus an optional repeat rule. We never store "9:00 +05:00";
// we store "09:00 in Asia/Karachi" so repeats stay at 09:00 across DST changes.

export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use the form YYYY-MM-DDTHH:mm")
  .refine((s) => DateTime.fromISO(s, { zone: "utc" }).isValid, "Not a real date or time");

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD")
  .refine((s) => DateTime.fromISO(s, { zone: "utc" }).isValid, "Not a real date");

const timeZone = z
  .string()
  .refine((tz) => IANAZone.isValidZone(tz), "Unknown time zone (use an IANA name like Asia/Karachi)");

export const recurrenceSchema = z
  .object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
    interval: z.number().int().min(1).max(999).default(1),
    // Weekly only. Defaults to the weekday of the start date.
    weekdays: z
      .array(z.enum(WEEKDAYS))
      .min(1)
      .refine((d) => new Set(d).size === d.length, "Weekdays must not repeat")
      .optional(),
    // Last local date (inclusive) on which the reminder may fire.
    until: localDate.optional(),
    // Total number of occurrences, including the first.
    count: z.number().int().min(1).max(1000).optional(),
  })
  .refine((r) => !(r.until && r.count), "Use either until or count, not both")
  .refine((r) => r.freq === "weekly" || !r.weekdays, "weekdays only applies to weekly repeats");

export const scheduleSchema = z
  .object({
    start: localDateTime,
    timeZone,
    recurrence: recurrenceSchema.nullable().default(null),
  })
  .refine(
    (s) => !s.recurrence?.until || s.recurrence.until >= s.start.slice(0, 10),
    "until must not be before the start date",
  );

export type Recurrence = z.infer<typeof recurrenceSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type ScheduleInput = z.input<typeof scheduleSchema>;

export function parseSchedule(input: unknown): Schedule {
  return scheduleSchema.parse(input);
}

/**
 * Converts a wall-clock time in a zone to a real instant.
 *
 * Daylight-saving rules (Luxon's behaviour, pinned by tests):
 * - A time that does not exist (clocks jump 02:00 -> 03:00) moves forward by
 *   the gap, so 02:30 becomes 03:30.
 * - A time that happens twice (clocks fall back 02:00 -> 01:00) uses the
 *   first one, so the reminder fires once.
 */
export function wallTimeToInstant(local: string, zone: string): Date {
  const dt = DateTime.fromISO(local, { zone });
  if (!dt.isValid) throw new Error(`Invalid local time ${local} in ${zone}: ${dt.invalidReason}`);
  return dt.toJSDate();
}
