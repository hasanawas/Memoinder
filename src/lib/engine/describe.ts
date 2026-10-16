import { DateTime } from "luxon";
import type { Schedule, Weekday } from "./schedule.ts";

const DAY_NAMES: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};
const UNIT = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;
const LUXON_TO_WEEKDAY: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th");
  return `${n}${s}`;
}

/** Plain-English summary, e.g. "Every 2 weeks on Mon, Wed at 09:00 (Asia/Karachi)". */
export function describeSchedule(schedule: Schedule): string {
  const start = DateTime.fromISO(schedule.start, { zone: "utc" });
  const time = start.toFormat("HH:mm");
  const zone = `(${schedule.timeZone})`;
  const r = schedule.recurrence;
  if (!r) return `Once on ${start.toFormat("ccc d LLL yyyy")} at ${time} ${zone}`;

  const every = r.interval === 1 ? `Every ${UNIT[r.freq]}` : `Every ${r.interval} ${UNIT[r.freq]}s`;
  let when = "";
  if (r.freq === "weekly") {
    const days = r.weekdays ?? [LUXON_TO_WEEKDAY[start.weekday - 1]];
    when = ` on ${days.map((d) => DAY_NAMES[d]).join(", ")}`;
  } else if (r.freq === "monthly") {
    when = ` on the ${ordinal(start.day)}${start.day > 28 ? " (or the last day)" : ""}`;
  } else if (r.freq === "yearly") {
    when = ` on ${start.toFormat("d LLL")}`;
  }
  let end = "";
  if (r.count) end = `, ${r.count} times`;
  if (r.until) end = `, until ${DateTime.fromISO(r.until).toFormat("d LLL yyyy")}`;
  return `${every}${when} at ${time} ${zone}${end}, starting ${start.toFormat("d LLL yyyy")}`;
}
