import { describe, expect, it } from "vitest";
import type { ReminderRow } from "@/lib/reminders/form";
import { listInRange, matchReminders, proposeCreate, proposeReschedule, resolveWhen } from "./resolve";

// Friday 16 Oct 2026, 13:00 in Karachi (UTC+5, no DST).
const ctx = { now: new Date("2026-10-16T08:00:00Z"), timeZone: "Asia/Karachi" };
const create = (title: string, when: string, repeat: null | object = null) =>
  proposeCreate({ action: "create", title, when, repeat: repeat as never }, ctx);

describe("resolveWhen", () => {
  it.each([
    ["tomorrow at 9am", "2026-10-17T09:00"],
    ["oct 20 at 3pm", "2026-10-20T15:00"],
    ["next friday 17:30", "2026-10-23T17:30"],
    ["tonight at 8", "2026-10-16T20:00"],
    ["tomorrow morning at 7", "2026-10-17T07:00"],
    ["in 2 hours", "2026-10-16T15:00"],
    ["in 30 minutes", "2026-10-16T13:30"],
    ["at 07:30", "2026-10-17T07:30"],
    ["5pm", "2026-10-16T17:00"],
    ["on the 5th at 10am", "2026-11-05T10:00"],
    ["the 20th at 9am", "2026-10-20T09:00"],
  ])("%s -> %s", (when, start) => {
    expect(resolveWhen(when, ctx)).toEqual({ ok: true, start });
  });

  it("asks for a time when only a day is given", () => {
    expect(resolveWhen("tomorrow", ctx)).toEqual({ ok: false, need: "time", question: "What time on Saturday 17 Oct?" });
  });

  it("asks morning or evening for a bare hour", () => {
    expect(resolveWhen("tomorrow at 5", ctx)).toEqual({
      ok: false,
      need: "meridiem",
      question: "Do you mean 5 in the morning or 5 in the evening?",
      options: ["tomorrow at 5 am", "tomorrow at 5 pm"],
    });
  });

  it("says when it cannot read the words at all", () => {
    const r = resolveWhen("whenever", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.need).toBe("when");
  });

  it("uses the zone's real offset across a DST change", () => {
    // London: clocks go back on 25 Oct 2026. 9am the next day is 09:00 GMT.
    const london = { now: new Date("2026-10-24T12:00:00Z"), timeZone: "Europe/London" };
    expect(resolveWhen("monday at 9am", london)).toEqual({ ok: true, start: "2026-10-26T09:00" });
  });
});

describe("proposeCreate", () => {
  it("proposes a one-off with exact next times", () => {
    const r = create("Call the bank", "tomorrow at 9am");
    expect(r.kind).toBe("proposal");
    if (r.kind === "proposal") {
      expect(r.proposal.draft).toEqual({
        title: "Call the bank",
        notes: null,
        schedule: { start: "2026-10-17T09:00", timeZone: "Asia/Karachi", recurrence: null },
      });
      expect(r.proposal.summary).toBe("Once on Sat 17 Oct 2026 at 09:00 (Asia/Karachi)");
      expect(r.proposal.nextTimes).toEqual(["Sat 17 Oct 2026, 09:00"]);
    }
  });

  it("starts a weekly repeat on its first chosen weekday", () => {
    const r = create("Gym", "at 7am", { freq: "weekly", interval: 1, weekdays: ["MO", "TH"] });
    if (r.kind !== "proposal") throw new Error(r.question);
    expect(r.proposal.draft.schedule.start).toBe("2026-10-19T07:00");
    expect(r.proposal.nextTimes).toEqual(["Mon 19 Oct 2026, 07:00", "Thu 22 Oct 2026, 07:00", "Mon 26 Oct 2026, 07:00"]);
  });

  it("asks for a title, then for a time", () => {
    expect(create("", "tomorrow at 9am")).toMatchObject({ kind: "clarify", need: "title" });
    expect(create("Stretch", "")).toMatchObject({ kind: "clarify", need: "when", question: "When should I remind you?" });
    expect(create("Gym", "", { freq: "daily", interval: 1 })).toMatchObject({ kind: "clarify", need: "time" });
  });

  it("offers ready-made morning/evening answers", () => {
    const r = create("Call mum", "tomorrow at 5");
    expect(r.kind).toBe("clarify");
    if (r.kind === "clarify") {
      expect(r.options?.map((o) => o.label)).toEqual(["Morning (AM)", "Evening (PM)"]);
      const pm = r.options![1].intent;
      const again = proposeCreate(pm as never, ctx);
      expect(again.kind === "proposal" && again.proposal.draft.schedule.start).toBe("2026-10-17T17:00");
    }
  });
});

const row = (over: Partial<ReminderRow>): ReminderRow => ({
  id: crypto.randomUUID(),
  title: "Dentist",
  notes: null,
  start_local: "2026-10-20T09:00:00",
  time_zone: "Asia/Karachi",
  recurrence: null,
  rrule: null,
  next_fire_at: "2026-10-20T04:00:00Z",
  status: "active",
  created_at: "",
  updated_at: "",
  ...over,
});

describe("matchReminders", () => {
  const rows = [row({ title: "Dentist appointment" }), row({ title: "Gym" }), row({ title: "Call the dentist back" })];
  it("matches every meaningful word, by prefix", () => {
    expect(matchReminders("gym", rows).map((r) => r.title)).toEqual(["Gym"]);
    expect(matchReminders("the dentist reminder", rows)).toHaveLength(2);
    expect(matchReminders("dentist app", rows).map((r) => r.title)).toEqual(["Dentist appointment"]);
    expect(matchReminders("the", rows)).toEqual([]);
  });
});

describe("proposeReschedule", () => {
  it("keeps the title and repeat, changes the time", () => {
    const weekly = row({ recurrence: { freq: "weekly", interval: 1 } });
    const r = proposeReschedule({ action: "reschedule", target: "dentist", when: "tuesday at 4pm" }, weekly, ctx);
    if (r.kind !== "proposal") throw new Error(r.question);
    expect(r.proposal.draft.title).toBe("Dentist");
    expect(r.proposal.draft.schedule).toEqual({
      start: "2026-10-20T16:00",
      timeZone: "Asia/Karachi",
      recurrence: { freq: "weekly", interval: 1 },
    });
  });
});

describe("listInRange", () => {
  const rows = [
    row({ title: "Later today", next_fire_at: "2026-10-16T12:00:00Z" }), // 17:00 local
    row({ title: "Tomorrow", next_fire_at: "2026-10-17T04:00:00Z" }),
    row({ title: "Next week", next_fire_at: "2026-10-22T04:00:00Z" }),
    row({ title: "Far", next_fire_at: "2027-01-01T04:00:00Z" }),
    row({ title: "Done", status: "completed", next_fire_at: null }),
  ];
  it.each([
    ["today", ["Later today"]],
    ["tomorrow", ["Tomorrow"]],
    ["week", ["Later today", "Tomorrow", "Next week"]],
    ["all", ["Later today", "Tomorrow", "Next week", "Far"]],
  ] as const)("%s", (range, titles) => {
    expect(listInRange(rows, range, ctx).map((r) => r.title)).toEqual(titles);
  });
});
