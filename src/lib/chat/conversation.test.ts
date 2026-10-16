import { describe, expect, it } from "vitest";
import { interpretWithRules } from "@/lib/ai/rules";
import { afterParse, beforeParse, emptyMemory, followUpWhen, mergeWhen, smallTalk, type ChatMemory } from "./conversation";

// Thursday 15 Oct 2026, 10:00 in Karachi.
const ctx = { now: new Date("2026-10-15T05:00:00Z"), timeZone: "Asia/Karachi" };

describe("small talk", () => {
  it.each([
    ["hi", "greeting"],
    ["Hello there!", "greeting"],
    ["assalamualaikum", "greeting"],
    ["thanks!", "thanks"],
    ["ok thank you", "thanks"],
    ["great", "ack"],
    ["how are you?", "howAreYou"],
    ["who are you", "whoAreYou"],
    ["what can you do?", "help"],
    ["bye", "bye"],
  ])("%s -> %s", (text, kind) => {
    expect(smallTalk(text)).toBe(kind);
  });

  it("leaves real requests alone", () => {
    for (const t of ["remind me to call mum tomorrow at 6pm", "hey remind me to stretch at 5pm", "thank the team on friday at 9am"]) {
      expect(smallTalk(t)).toBeNull();
    }
  });

  it("does not say the same thing twice in a row", () => {
    const m = emptyMemory();
    const a = beforeParse("hi", m, ctx);
    const b = beforeParse("hello", m, ctx);
    expect(a).not.toEqual(b);
    const u1 = afterParse({ action: "unknown" }, m, ctx);
    const u2 = afterParse({ action: "unknown" }, m, ctx);
    expect(u1).not.toEqual(u2);
  });
});

describe("follow-ups", () => {
  it.each([
    ["make it 7pm", "7pm"],
    ["actually, make it 7pm", "7pm"],
    ["change it to friday", "friday"],
    ["no, 8am", "8am"],
    ["friday at 9 instead", "friday at 9"],
    ["how about tomorrow at noon?", "tomorrow at noon"],
  ])("%s -> %s", (text, when) => {
    expect(followUpWhen(text, ctx)).toBe(when);
  });

  it("ignores messages that are new requests", () => {
    expect(followUpWhen("remind me to call mum at 7pm", ctx)).toBeNull();
    expect(followUpWhen("no", ctx)).toBeNull();
  });

  it("keeps the day when only the time changes, and the time when only the day changes", () => {
    expect(mergeWhen("tomorrow at 6pm", "7pm", ctx)).toBe("October 16 2026 7pm");
    expect(mergeWhen("tomorrow at 6pm", "friday", ctx)).toBe("friday at 18:00");
    expect(mergeWhen("tomorrow at 6pm", "monday at 9am", ctx)).toBe("monday at 9am");
  });

  it("changes the reminder still being proposed", () => {
    const m: ChatMemory = { used: {}, pendingCreate: { action: "create", title: "Call mum", when: "tomorrow at 6pm", repeat: null } };
    expect(beforeParse("make it 7pm", m, ctx)).toEqual({
      intent: { action: "create", title: "Call mum", when: "October 16 2026 7pm", repeat: null },
    });
  });

  it("moves the reminder just saved", () => {
    const m: ChatMemory = { used: {}, lastReminder: { id: "r1", title: "Call mum", when: "tomorrow at 6pm" } };
    expect(beforeParse("actually make it 7pm", m, ctx)).toEqual({
      intent: { action: "reschedule", target: "Call mum", targetId: "r1", when: "October 16 2026 7pm" },
    });
  });

  it("reads it/that as the reminder being discussed", () => {
    const m: ChatMemory = { used: {}, lastReminder: { id: "r1", title: "Gym" } };
    expect(afterParse(interpretWithRules("delete it", ctx), m, ctx)).toEqual({ action: "delete", target: "Gym", targetId: "r1" });
    expect(afterParse(interpretWithRules("move that to friday at 8am", ctx), m, ctx)).toMatchObject({
      action: "reschedule",
      targetId: "r1",
      when: "friday at 8am",
    });
  });

  it("asks which reminder when there is nothing to refer to", () => {
    const r = afterParse(interpretWithRules("delete it", ctx), emptyMemory(), ctx);
    expect(r).toHaveProperty("reply");
  });
});
