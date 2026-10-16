import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import {
  describeSchedule,
  nextOccurrence,
  scheduleSchema,
  upcoming,
  type Recurrence,
  type Schedule,
  type Weekday,
} from "@/lib/engine";
import type { Intent, InterpretContext } from "@/lib/ai/intent";
import { chronoRef, normalizeDayOfMonth } from "@/lib/ai/rules";
import type { ReminderDraft, ReminderRow } from "@/lib/reminders/form";
import { rowToSchedule } from "@/lib/reminders/form";

// Deterministic second half of the chat pipeline: turns an Intent (from the
// rule parser or the local model) into an exact schedule, or a question when
// something is missing or ambiguous. No AI runs here.

export type Need = "when" | "time" | "meridiem" | "title" | "which";

export interface Clarify {
  kind: "clarify";
  need: Need;
  question: string;
  /** The intent to complete with the user's answer. */
  pending: Intent;
  /** Ready-made answers, each a complete intent to resubmit. */
  options?: { label: string; intent: Intent }[];
}

export type WhenResult = { ok: true; start: string } | { ok: false; need: Need; question: string; options?: string[] };

const CASUAL_MERIDIEM = /casualReference\/(?:morning|afternoon|evening|night|tonight|noon|midnight)/;

/** Exact wall-clock start ("YYYY-MM-DDTHH:mm") for the user's words, in their zone. */
export function resolveWhen(when: string, ctx: InterpretContext): WhenResult {
  if (!when.trim()) return { ok: false, need: "when", question: "When should I remind you?" };
  const text = normalizeDayOfMonth(when, ctx);
  const r = chrono.parse(text, chronoRef(ctx), { forwardDate: true })[0];
  if (!r) {
    return {
      ok: false,
      need: "when",
      question: `I couldn't read "${when}" as a date or time. Try something like "tomorrow at 9am" or "Friday 17:30".`,
    };
  }
  const tags = [...r.tags()].join(" ");
  const s = r.start;

  if (!s.isCertain("hour")) {
    const day = DateTime.fromObject(
      { year: s.get("year")!, month: s.get("month")!, day: s.get("day")! },
      { zone: ctx.timeZone },
    ).toFormat("cccc d LLL");
    return { ok: false, need: "time", question: `What time on ${day}?` };
  }

  const hour = s.get("hour")!;
  const leadingZero = /\b0\d:\d{2}\b/.test(r.text);
  const ambiguous =
    !s.isCertain("meridiem") &&
    !CASUAL_MERIDIEM.test(tags) &&
    !tags.includes("relativeDateAndTime") &&
    !leadingZero &&
    hour >= 1 &&
    hour <= 12;
  if (ambiguous) {
    const h = hour === 12 ? 12 : hour;
    return {
      ok: false,
      need: "meridiem",
      question: `Do you mean ${h} in the morning or ${h} in the evening?`,
      options: [text.replace(r.text, `${r.text} am`), text.replace(r.text, `${r.text} pm`)],
    };
  }

  // "in 2 hours" is an exact instant; "tomorrow at 9" is a wall-clock time.
  const wall = tags.includes("relativeDateAndTime")
    ? DateTime.fromJSDate(s.date(), { zone: ctx.timeZone })
    : DateTime.fromObject(
        { year: s.get("year")!, month: s.get("month")!, day: s.get("day")!, hour, minute: s.get("minute") ?? 0 },
        { zone: ctx.timeZone },
      );
  return { ok: true, start: wall.toFormat("yyyy-LL-dd'T'HH:mm") };
}

const LUXON_WEEKDAY: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** A weekly repeat on chosen days should start on the first of those days. */
function alignStart(start: string, recurrence: Recurrence | null): string {
  if (recurrence?.freq !== "weekly" || !recurrence.weekdays?.length) return start;
  let d = DateTime.fromISO(start, { zone: "utc" });
  for (let i = 0; i < 7 && !recurrence.weekdays.includes(LUXON_WEEKDAY[d.weekday - 1]); i++) d = d.plus({ days: 1 });
  return d.toFormat("yyyy-LL-dd'T'HH:mm");
}

export interface Proposal {
  draft: ReminderDraft;
  summary: string;
  nextTimes: string[];
}

function whenClarify(w: Extract<WhenResult, { ok: false }>, pending: Intent): Clarify {
  const field = pending.action === "create" || pending.action === "reschedule" ? pending : null;
  return {
    kind: "clarify",
    need: w.need,
    question: w.question,
    pending,
    options:
      field && w.options
        ? w.options.map((o) => ({ label: /am$/.test(o) ? "Morning (AM)" : "Evening (PM)", intent: { ...field, when: o } }))
        : undefined,
  };
}

function buildProposal(
  draftBase: { title: string; notes: string | null },
  start: string,
  recurrence: Recurrence | null,
  ctx: InterpretContext,
): { ok: true; proposal: Proposal } | { ok: false; question: string } {
  const parsed = scheduleSchema.safeParse({ start: alignStart(start, recurrence), timeZone: ctx.timeZone, recurrence });
  if (!parsed.success) return { ok: false, question: parsed.error.issues[0].message };
  const schedule: Schedule = parsed.data;
  const first = nextOccurrence(schedule, ctx.now);
  if (!first) return { ok: false, question: "That time has already passed. When should it be?" };
  const times = [first, ...upcoming(schedule, first, 2)];
  return {
    ok: true,
    proposal: {
      draft: { ...draftBase, schedule },
      summary: describeSchedule(schedule),
      nextTimes: times.map((t) => DateTime.fromJSDate(t, { zone: ctx.timeZone }).toFormat("ccc d LLL yyyy, HH:mm")),
    },
  };
}

export function proposeCreate(
  intent: Extract<Intent, { action: "create" }>,
  ctx: InterpretContext,
): { kind: "proposal"; proposal: Proposal } | Clarify {
  if (!intent.title.trim()) {
    return { kind: "clarify", need: "title", question: "What should I remind you about?", pending: intent };
  }
  const w = resolveWhen(intent.when, ctx);
  if (!w.ok) {
    // A repeat with only a time ("every Monday at 8") is fine; with no words at all, ask for the time.
    if (intent.repeat && w.need === "when" && !intent.when.trim())
      return { kind: "clarify", need: "time", question: "What time should it repeat?", pending: intent };
    return whenClarify(w, intent);
  }
  const recurrence: Recurrence | null = intent.repeat
    ? { ...intent.repeat, interval: intent.repeat.interval ?? 1 }
    : null;
  const built = buildProposal({ title: intent.title.trim(), notes: null }, w.start, recurrence, ctx);
  if (!built.ok) return { kind: "clarify", need: "when", question: built.question, pending: { ...intent, when: "" } };
  return { kind: "proposal", proposal: built.proposal };
}

export function proposeReschedule(
  intent: Extract<Intent, { action: "reschedule" }>,
  row: ReminderRow,
  ctx: InterpretContext,
): { kind: "proposal"; proposal: Proposal } | Clarify {
  const w = resolveWhen(intent.when, ctx);
  if (!w.ok) return whenClarify(w, { ...intent, targetId: row.id });
  const current = rowToSchedule(row);
  const built = buildProposal({ title: row.title, notes: row.notes }, w.start, current.recurrence, ctx);
  if (!built.ok) return { kind: "clarify", need: "when", question: built.question, pending: { ...intent, targetId: row.id, when: "" } };
  return { kind: "proposal", proposal: built.proposal };
}

const STOP = new Set(["the", "a", "an", "my", "reminder", "reminders", "to", "for", "about", "of"]);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && !STOP.has(w));

/** Reminders whose title contains every meaningful word of the target. */
export function matchReminders(target: string, rows: ReminderRow[]): ReminderRow[] {
  const want = words(target);
  if (!want.length) return [];
  return rows.filter((r) => {
    const have = words(r.title);
    return want.every((w) => have.some((h) => h.startsWith(w)));
  });
}

/** Active reminders whose next time falls in the range, soonest first. */
export function listInRange(
  rows: ReminderRow[],
  range: Extract<Intent, { action: "list" }>["range"],
  ctx: InterpretContext,
): ReminderRow[] {
  const now = DateTime.fromJSDate(ctx.now, { zone: ctx.timeZone });
  const [from, to] =
    range === "today"
      ? [now, now.endOf("day")]
      : range === "tomorrow"
        ? [now.plus({ days: 1 }).startOf("day"), now.plus({ days: 1 }).endOf("day")]
        : range === "week"
          ? [now, now.plus({ days: 7 })]
          : [now, null];
  return rows
    .filter((r) => r.status === "active" && r.next_fire_at)
    .filter((r) => {
      const t = DateTime.fromISO(r.next_fire_at!);
      return t >= from && (!to || t <= to);
    })
    .sort((a, b) => a.next_fire_at!.localeCompare(b.next_fire_at!));
}
