import { describe, expect, it } from "vitest";
import { draftToRow, emptyFormValues, parseForm, readForm, rowToFormValues, rowToSchedule, type FormValues, type ReminderRow } from "./form";

const now = new Date("2026-10-16T08:00:00Z");
const values = (over: Partial<FormValues> = {}): FormValues => ({
  ...emptyFormValues("Asia/Karachi"),
  title: "Call the bank",
  date: "2026-10-20",
  time: "09:00",
  ...over,
});

function rowFor(v: FormValues) {
  const parsed = parseForm(v);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const row = draftToRow(parsed.draft, now);
  if (!row.ok) throw new Error(JSON.stringify(row.errors));
  return row.row;
}

describe("readForm", () => {
  it("reads fields, including repeated weekday checkboxes", () => {
    const fd = new FormData();
    fd.set("title", "Gym");
    fd.append("weekdays", "MO");
    fd.append("weekdays", "TH");
    const v = readForm(fd);
    expect(v.title).toBe("Gym");
    expect(v.weekdays).toEqual(["MO", "TH"]);
    expect(v.repeat).toBe("none");
    expect(v.interval).toBe("1");
  });
});

describe("parseForm + draftToRow", () => {
  it("builds a one-off reminder row with next_fire_at in UTC", () => {
    expect(rowFor(values())).toEqual({
      title: "Call the bank",
      notes: null,
      start_local: "2026-10-20T09:00:00",
      time_zone: "Asia/Karachi",
      recurrence: null,
      rrule: null,
      next_fire_at: "2026-10-20T04:00:00.000Z",
      status: "active",
    });
  });

  it("builds a weekly repeat on chosen days", () => {
    const row = rowFor(values({ repeat: "weekly", weekdays: ["MO", "WE"], interval: "2" }));
    expect(row.recurrence).toEqual({ freq: "weekly", interval: 2, weekdays: ["MO", "WE"] });
    expect(row.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
  });

  it("adds an end date or count only when chosen", () => {
    expect(rowFor(values({ repeat: "daily", end: "until", until: "2026-11-01" })).recurrence).toEqual({
      freq: "daily",
      interval: 1,
      until: "2026-11-01",
    });
    expect(rowFor(values({ repeat: "daily", end: "count", count: "5" })).recurrence).toEqual({
      freq: "daily",
      interval: 1,
      count: 5,
    });
    expect(rowFor(values({ repeat: "none", end: "count", count: "5" })).recurrence).toBeNull();
  });

  it("uses the next future occurrence for a repeat that started in the past", () => {
    const row = rowFor(values({ date: "2026-10-01", repeat: "daily" }));
    expect(row.next_fire_at).toBe("2026-10-17T04:00:00.000Z");
  });

  it.each<[Partial<FormValues>, string, string]>([
    [{ title: "  " }, "title", "Give the reminder a title"],
    [{ date: "" }, "date", "Pick a date"],
    [{ time: "" }, "time", "Pick a time"],
    [{ timeZone: "Nowhere/Land" }, "timeZone", "Unknown time zone"],
    [{ repeat: "daily", interval: "0" }, "interval", "At least 1"],
    [{ repeat: "daily", end: "until", until: "" }, "until", "Pick an end date"],
    [{ repeat: "daily", end: "until", until: "2026-10-01" }, "until", "must not be before"],
    [{ repeat: "daily", end: "count", count: "abc" }, "count", "whole number"],
    [{ date: "2026-02-30" }, "date", "Not a real date"],
  ])("rejects %j on %s", (over, field, message) => {
    const r = parseForm(values(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field as keyof FormValues]).toContain(message);
  });

  it("refuses a one-off time that has passed", () => {
    const parsed = parseForm(values({ date: "2026-10-15" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(draftToRow(parsed.draft, now)).toEqual({ ok: false, errors: { date: "That time has already passed" } });
  });

  it("refuses a repeat whose occurrences are all in the past", () => {
    const parsed = parseForm(values({ date: "2026-10-01", repeat: "daily", end: "count", count: "3" }));
    if (!parsed.ok) throw new Error("expected valid form");
    expect(draftToRow(parsed.draft, now)).toEqual({ ok: false, errors: { date: "This repeat has no times left after now" } });
  });
});

describe("round trip through a database row", () => {
  it("rebuilds the same form values and schedule", () => {
    const v = values({ notes: "Ask about fees", repeat: "weekly", weekdays: ["FR"], end: "count", count: "4" });
    const input = rowFor(v);
    const row: ReminderRow = {
      ...input,
      id: "x",
      created_at: "",
      updated_at: "",
      // PostgREST returns timestamp columns without a trailing Z.
      start_local: "2026-10-20T09:00:00",
    };
    expect(rowToFormValues(row)).toEqual(v);
    expect(rowToSchedule(row)).toEqual({
      start: "2026-10-20T09:00",
      timeZone: "Asia/Karachi",
      recurrence: { freq: "weekly", interval: 1, weekdays: ["FR"], count: 4 },
    });
  });
});
