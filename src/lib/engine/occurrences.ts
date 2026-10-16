import { DateTime } from "luxon";
import { RRule, type Options, type Weekday as RRuleWeekday } from "rrule";
import { wallTimeToInstant, type Schedule, type Weekday } from "./schedule";

// rrule's own time-zone support is unreliable, so we use the common
// "floating time" technique: rrule works on wall-clock times disguised as UTC,
// and Luxon converts each wall-clock result into the real zone afterwards.

const RRULE_DAYS: Record<Weekday, RRuleWeekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};
const LUXON_TO_WEEKDAY: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]; // Luxon weekday 1..7

const FREQ = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
} as const;

/** Wall-clock time stored in a Date's UTC fields. */
function floating(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

function floatingToInstant(d: Date, zone: string): Date {
  return DateTime.fromObject(
    {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
    },
    { zone },
  ).toJSDate();
}

/**
 * Days 29-31 do not exist in every month. RFC 5545 would silently skip those
 * months; people expect "monthly on the 31st" to fire on the last day instead.
 * "The last of days 28..d that exists" does exactly that.
 */
function clampedMonthDays(day: number): Partial<Options> {
  if (day <= 28) return { bymonthday: [day] };
  const days = [];
  for (let d = 28; d <= day; d++) days.push(d);
  return { bymonthday: days, bysetpos: [-1] };
}

export function toRRule(schedule: Schedule): RRule | null {
  const r = schedule.recurrence;
  if (!r) return null;
  const start = DateTime.fromISO(schedule.start, { zone: "utc" });
  const opts: Partial<Options> = {
    freq: FREQ[r.freq],
    interval: r.interval,
    dtstart: floating(start),
    count: r.count ?? null,
    until: r.until ? floating(DateTime.fromISO(`${r.until}T23:59:59`, { zone: "utc" })) : null,
  };
  if (r.freq === "weekly") {
    const days = r.weekdays ?? [LUXON_TO_WEEKDAY[start.weekday - 1]];
    opts.byweekday = days.map((d) => RRULE_DAYS[d]);
  } else if (r.freq === "monthly") {
    Object.assign(opts, clampedMonthDays(start.day));
  } else if (r.freq === "yearly") {
    Object.assign(opts, { bymonth: [start.month] }, clampedMonthDays(start.day));
  }
  return new RRule(opts);
}

/** RFC 5545 text for storage, e.g. "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE". */
export function toRRuleString(schedule: Schedule): string | null {
  const rule = toRRule(schedule);
  if (!rule) return null;
  return rule
    .toString()
    .split("\n")
    .find((l) => l.startsWith("RRULE:"))!
    .slice("RRULE:".length);
}

const MAX_SCAN = 5000;

/**
 * The first occurrence strictly after `after`, as a real instant, or null when
 * the schedule has no more occurrences.
 */
export function nextOccurrence(schedule: Schedule, after: Date): Date | null {
  const first = wallTimeToInstant(schedule.start, schedule.timeZone);
  const rule = toRRule(schedule);
  if (!rule) return first > after ? first : null;
  if (first > after) return first;

  // Start a day early in floating time: offsets differ from UTC by < 1 day.
  let cursor = new Date(
    floating(DateTime.fromJSDate(after, { zone: schedule.timeZone })).getTime() - 86_400_000,
  );
  for (let i = 0; i < MAX_SCAN; i++) {
    const f = rule.after(cursor, false);
    if (!f) return null;
    const instant = floatingToInstant(f, schedule.timeZone);
    if (instant > after) return instant;
    cursor = f;
  }
  throw new Error("nextOccurrence scanned too far; schedule is likely invalid");
}

/** Up to `limit` upcoming occurrences after `after`, for previews in the UI. */
export function upcoming(schedule: Schedule, after: Date, limit: number): Date[] {
  const out: Date[] = [];
  let cursor = after;
  while (out.length < limit) {
    const next = nextOccurrence(schedule, cursor);
    if (!next) break;
    out.push(next);
    cursor = next;
  }
  return out;
}
