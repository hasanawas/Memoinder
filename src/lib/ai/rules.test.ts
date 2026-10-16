import { describe, expect, it } from "vitest";
import { findRepeat, interpretWithRules } from "./rules";

// Friday 16 Oct 2026, 13:00 in Karachi.
const ctx = { now: new Date("2026-10-16T08:00:00Z"), timeZone: "Asia/Karachi" };
const parse = (t: string) => interpretWithRules(t, ctx);

describe("rule-based provider: create", () => {
  it.each([
    ["Remind me to call the bank tomorrow at 9am", "Call the bank", "tomorrow at 9am"],
    ["remind me to pay rent on oct 20 at 3pm", "Pay rent", "oct 20 at 3pm"],
    ["Set a reminder to water the plants in 2 hours", "Water the plants", "in 2 hours"],
    ["remind me about the dentist next friday at 4:30pm", "The dentist", "next friday at 4:30pm"],
    ["Take out the trash tonight at 8", "Take out the trash", "tonight at 8"],
    ["remind me to stretch", "Stretch", ""],
  ])("%s", (text, title, when) => {
    expect(parse(text)).toEqual({ action: "create", title, when, repeat: null });
  });

  it("finds repeats and keeps the time", () => {
    expect(parse("remind me to go to the gym every monday and thursday at 7am")).toEqual({
      action: "create",
      title: "Go to the gym",
      when: "at 7am",
      repeat: { freq: "weekly", interval: 1, weekdays: ["MO", "TH"] },
    });
    expect(parse("Pay rent every month on the 1st at 10am")).toEqual({
      action: "create",
      title: "Pay rent",
      when: "on the 1st at 10am",
      repeat: { freq: "monthly", interval: 1 },
    });
    expect(parse("take vitamins daily at 8:00")).toMatchObject({ title: "Take vitamins", repeat: { freq: "daily" } });
  });

  it("returns unknown for chit-chat", () => {
    expect(parse("hello there")).toEqual({ action: "unknown" });
  });
});

describe("findRepeat", () => {
  it.each([
    ["every day", { freq: "daily", interval: 1 }],
    ["every other week", { freq: "weekly", interval: 2 }],
    ["every 3 months", { freq: "monthly", interval: 3 }],
    ["every year", { freq: "yearly", interval: 1 }],
    ["annually", { freq: "yearly", interval: 1 }],
    ["every weekday", { freq: "weekly", interval: 1, weekdays: ["MO", "TU", "WE", "TH", "FR"] }],
    ["every tue, wed & fri", { freq: "weekly", interval: 1, weekdays: ["TU", "WE", "FR"] }],
    ["every morning", { freq: "daily", interval: 1 }],
  ])("%s", (text, repeat) => {
    expect(findRepeat(text)?.repeat).toEqual(repeat);
  });

  it("finds nothing in a one-off", () => {
    expect(findRepeat("tomorrow at 9")).toBeNull();
  });
});

describe("rule-based provider: other actions", () => {
  it.each([
    ["what's coming up?", "all"],
    ["show my reminders", "all"],
    ["what do I have tomorrow", "tomorrow"],
    ["any reminders today?", "today"],
    ["what's planned this week", "week"],
    ["anything on my plate today?", "today"],
  ])("%s lists %s", (text, range) => {
    expect(parse(text)).toEqual({ action: "list", range });
  });

  it("deletes by name", () => {
    expect(parse("delete the dentist reminder")).toEqual({ action: "delete", target: "dentist" });
    expect(parse("cancel gym")).toEqual({ action: "delete", target: "gym" });
  });

  it("reschedules by name", () => {
    expect(parse("move the dentist reminder to friday at 4pm")).toEqual({
      action: "reschedule",
      target: "dentist",
      when: "friday at 4pm",
    });
  });
});
