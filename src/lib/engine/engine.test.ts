import { describe, expect, it } from "vitest";
import {
  advance,
  classifyDue,
  describeSchedule,
  nextOccurrence,
  parseSchedule,
  toRRuleString,
  upcoming,
  wallTimeToInstant,
  type ScheduleInput,
} from ".";

const iso = (d: Date | null) => d?.toISOString() ?? null;
const at = (s: string) => new Date(s);
const sched = (s: ScheduleInput) => parseSchedule(s);

describe("parseSchedule", () => {
  it("accepts a one-off reminder", () => {
    expect(sched({ start: "2026-10-20T09:00", timeZone: "Asia/Karachi" }).recurrence).toBeNull();
  });

  it.each([
    [{ start: "2026-10-20 09:00", timeZone: "Asia/Karachi" }, "YYYY-MM-DDTHH:mm"],
    [{ start: "2026-02-30T09:00", timeZone: "Asia/Karachi" }, "Not a real date"],
    [{ start: "2026-10-20T09:00", timeZone: "Mars/Olympus" }, "Unknown time zone"],
    [
      { start: "2026-10-20T09:00", timeZone: "UTC", recurrence: { freq: "daily", count: 2, until: "2026-12-01" } },
      "either until or count",
    ],
    [
      { start: "2026-10-20T09:00", timeZone: "UTC", recurrence: { freq: "daily", weekdays: ["MO"] } },
      "only applies to weekly",
    ],
    [
      { start: "2026-10-20T09:00", timeZone: "UTC", recurrence: { freq: "daily", until: "2026-10-19" } },
      "must not be before",
    ],
    [{ start: "2026-10-20T09:00", timeZone: "UTC", recurrence: { freq: "daily", interval: 0 } }, ">=1"],
  ])("rejects %j", (input, message) => {
    expect(() => parseSchedule(input)).toThrow(message);
  });
});

describe("wallTimeToInstant", () => {
  it("applies the zone's offset", () => {
    expect(iso(wallTimeToInstant("2026-10-20T09:00", "Asia/Karachi"))).toBe("2026-10-20T04:00:00.000Z");
  });

  it("moves a time inside the spring-forward gap ahead by the gap", () => {
    // New York skips 02:00-03:00 on 2026-03-08.
    expect(iso(wallTimeToInstant("2026-03-08T02:30", "America/New_York"))).toBe("2026-03-08T07:30:00.000Z");
  });

  it("uses the first of two repeated fall-back times", () => {
    // New York repeats 01:00-02:00 on 2026-11-01; the first 01:30 is EDT (-04:00).
    expect(iso(wallTimeToInstant("2026-11-01T01:30", "America/New_York"))).toBe("2026-11-01T05:30:00.000Z");
  });
});

describe("nextOccurrence for one-off reminders", () => {
  const s = sched({ start: "2026-10-20T09:00", timeZone: "Asia/Karachi" });

  it("returns the start when it is still ahead", () => {
    expect(iso(nextOccurrence(s, at("2026-10-16T00:00Z")))).toBe("2026-10-20T04:00:00.000Z");
  });

  it("returns null once it has passed", () => {
    expect(nextOccurrence(s, at("2026-10-20T04:00Z"))).toBeNull();
  });
});

describe("nextOccurrence for repeats", () => {
  it("keeps 09:00 local time across a DST change", () => {
    // Clocks go back on 2026-10-25: 09:00 BST (08:00Z), then 09:00 GMT.
    const autumn = sched({ start: "2026-10-24T09:00", timeZone: "Europe/London", recurrence: { freq: "daily" } });
    expect(upcoming(autumn, at("2026-10-23T00:00Z"), 3).map(iso)).toEqual([
      "2026-10-24T08:00:00.000Z",
      "2026-10-25T09:00:00.000Z",
      "2026-10-26T09:00:00.000Z",
    ]);
    const spring = sched({ start: "2026-03-28T09:00", timeZone: "Europe/London", recurrence: { freq: "daily" } });
    // Clocks go forward on 2026-03-29: 09:00 GMT, then 09:00 BST (08:00Z).
    expect(upcoming(spring, at("2026-03-27T00:00Z"), 3).map(iso)).toEqual([
      "2026-03-28T09:00:00.000Z",
      "2026-03-29T08:00:00.000Z",
      "2026-03-30T08:00:00.000Z",
    ]);
  });

  it("fires once on the fall-back night and keeps the wall time after it", () => {
    const s = sched({ start: "2026-10-31T01:30", timeZone: "America/New_York", recurrence: { freq: "daily" } });
    expect(upcoming(s, at("2026-10-30T00:00Z"), 3).map(iso)).toEqual([
      "2026-10-31T05:30:00.000Z", // EDT
      "2026-11-01T05:30:00.000Z", // first 01:30, still EDT
      "2026-11-02T06:30:00.000Z", // EST
    ]);
  });

  it("shifts a daily time that falls in the spring-forward gap, only on that day", () => {
    const s = sched({ start: "2026-03-07T02:30", timeZone: "America/New_York", recurrence: { freq: "daily" } });
    expect(upcoming(s, at("2026-03-06T00:00Z"), 3).map(iso)).toEqual([
      "2026-03-07T07:30:00.000Z", // 02:30 EST
      "2026-03-08T07:30:00.000Z", // 02:30 does not exist; 03:30 EDT
      "2026-03-09T06:30:00.000Z", // 02:30 EDT
    ]);
  });

  it("repeats weekly on chosen weekdays", () => {
    // 2026-10-16 is a Friday.
    const s = sched({
      start: "2026-10-16T18:00",
      timeZone: "UTC",
      recurrence: { freq: "weekly", weekdays: ["MO", "WE"] },
    });
    expect(upcoming(s, at("2026-10-16T00:00Z"), 4).map(iso)).toEqual([
      "2026-10-16T18:00:00.000Z", // the start itself always counts
      "2026-10-19T18:00:00.000Z",
      "2026-10-21T18:00:00.000Z",
      "2026-10-26T18:00:00.000Z",
    ]);
  });

  it("defaults weekly repeats to the start's weekday and honours interval", () => {
    const s = sched({ start: "2026-10-16T08:00", timeZone: "UTC", recurrence: { freq: "weekly", interval: 2 } });
    expect(upcoming(s, at("2026-10-16T08:00Z"), 2).map(iso)).toEqual([
      "2026-10-30T08:00:00.000Z",
      "2026-11-13T08:00:00.000Z",
    ]);
  });

  it("fires monthly on the 31st, or the last day of shorter months", () => {
    const s = sched({ start: "2026-01-31T10:00", timeZone: "UTC", recurrence: { freq: "monthly" } });
    expect(upcoming(s, at("2026-01-01T00:00Z"), 4).map(iso)).toEqual([
      "2026-01-31T10:00:00.000Z",
      "2026-02-28T10:00:00.000Z",
      "2026-03-31T10:00:00.000Z",
      "2026-04-30T10:00:00.000Z",
    ]);
  });

  it("fires yearly on 29 Feb, or 28 Feb in other years", () => {
    const s = sched({ start: "2028-02-29T07:00", timeZone: "UTC", recurrence: { freq: "yearly" } });
    expect(upcoming(s, at("2028-01-01T00:00Z"), 3).map(iso)).toEqual([
      "2028-02-29T07:00:00.000Z",
      "2029-02-28T07:00:00.000Z",
      "2030-02-28T07:00:00.000Z",
    ]);
  });

  it("stops after count occurrences", () => {
    const s = sched({ start: "2026-10-16T09:00", timeZone: "UTC", recurrence: { freq: "daily", count: 2 } });
    expect(upcoming(s, at("2026-10-01T00:00Z"), 5)).toHaveLength(2);
  });

  it("includes the until date and stops after it", () => {
    const s = sched({
      start: "2026-10-16T09:00",
      timeZone: "Asia/Karachi",
      recurrence: { freq: "daily", until: "2026-10-18" },
    });
    expect(upcoming(s, at("2026-10-01T00:00Z"), 5).map(iso)).toEqual([
      "2026-10-16T04:00:00.000Z",
      "2026-10-17T04:00:00.000Z",
      "2026-10-18T04:00:00.000Z",
    ]);
  });

  it("works in zones ahead of UTC late in the evening", () => {
    // 23:30 in Auckland (+13:00 in October) is the previous UTC day.
    const s = sched({ start: "2026-10-16T23:30", timeZone: "Pacific/Auckland", recurrence: { freq: "daily" } });
    expect(iso(nextOccurrence(s, at("2026-10-16T10:30Z")))).toBe("2026-10-17T10:30:00.000Z");
  });
});

describe("classifyDue", () => {
  const fireAt = at("2026-10-16T09:00Z");
  it.each([
    ["2026-10-16T08:59Z", "pending"],
    ["2026-10-16T09:00Z", "on_time"],
    ["2026-10-16T09:02Z", "on_time"],
    ["2026-10-16T09:03Z", "late"],
    ["2026-10-17T09:00Z", "late"],
    ["2026-10-17T09:01Z", "missed"],
  ])("at %s is %s", (now, state) => {
    expect(classifyDue(fireAt, at(now))).toBe(state);
  });
});

describe("advance", () => {
  const daily = sched({ start: "2026-10-16T09:00", timeZone: "UTC", recurrence: { freq: "daily" } });

  it("moves to the next occurrence after a normal send", () => {
    const r = advance(daily, at("2026-10-16T09:00Z"), at("2026-10-16T09:01Z"));
    expect(iso(r.next)).toBe("2026-10-17T09:00:00.000Z");
    expect(r.skipped).toEqual([]);
  });

  it("skips occurrences missed during downtime instead of sending a burst", () => {
    const r = advance(daily, at("2026-10-16T09:00Z"), at("2026-10-19T12:00Z"));
    expect(iso(r.next)).toBe("2026-10-20T09:00:00.000Z");
    expect(r.skipped.map(iso)).toEqual([
      "2026-10-17T09:00:00.000Z",
      "2026-10-18T09:00:00.000Z",
      "2026-10-19T09:00:00.000Z",
    ]);
  });

  it("finishes a one-off reminder", () => {
    const once = sched({ start: "2026-10-16T09:00", timeZone: "UTC" });
    expect(advance(once, at("2026-10-16T09:00Z"), at("2026-10-16T09:01Z")).next).toBeNull();
  });
});

describe("toRRuleString", () => {
  it("is null for one-off reminders", () => {
    expect(toRRuleString(sched({ start: "2026-10-16T09:00", timeZone: "UTC" }))).toBeNull();
  });

  it("produces RFC 5545 text", () => {
    const s = sched({
      start: "2026-10-16T09:00",
      timeZone: "UTC",
      recurrence: { freq: "weekly", weekdays: ["MO", "WE"], count: 10 },
    });
    expect(toRRuleString(s)).toBe("FREQ=WEEKLY;INTERVAL=1;COUNT=10;BYDAY=MO,WE");
  });
});

describe("describeSchedule", () => {
  it.each<[ScheduleInput, string]>([
    [{ start: "2026-10-20T09:00", timeZone: "Asia/Karachi" }, "Once on Tue 20 Oct 2026 at 09:00 (Asia/Karachi)"],
    [
      { start: "2026-10-16T09:00", timeZone: "UTC", recurrence: { freq: "weekly", interval: 2, weekdays: ["MO", "WE"] } },
      "Every 2 weeks on Mon, Wed at 09:00 (UTC), starting 16 Oct 2026",
    ],
    [
      { start: "2026-01-31T10:00", timeZone: "UTC", recurrence: { freq: "monthly", count: 6 } },
      "Every month on the 31st (or the last day) at 10:00 (UTC), 6 times, starting 31 Jan 2026",
    ],
    [
      { start: "2026-10-16T07:30", timeZone: "UTC", recurrence: { freq: "daily", until: "2026-12-31" } },
      "Every day at 07:30 (UTC), until 31 Dec 2026, starting 16 Oct 2026",
    ],
  ])("describes %j", (input, text) => {
    expect(describeSchedule(parseSchedule(input))).toBe(text);
  });
});
