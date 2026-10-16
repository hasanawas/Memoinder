import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import type { Weekday } from "@/lib/engine";
import type { AIProvider, Intent, InterpretContext, Repeat } from "./intent";

// A deterministic, no-AI parser for common phrasings. It works everywhere
// (phones included) and is the fallback when the local model isn't running.

const DAY_WORDS: [RegExp, Weekday][] = [
  [/^mon/, "MO"],
  [/^tue/, "TU"],
  [/^wed/, "WE"],
  [/^thu/, "TH"],
  [/^fri/, "FR"],
  [/^sat/, "SA"],
  [/^sun/, "SU"],
];
// Longest spellings first: regex alternation takes the first that matches.
const DAY = "(?:mon|tues|tue|wednes|wed|thurs|thur|thu|fri|satur|sat|sun)(?:day)?s?\\b";
const UNIT_FREQ = { day: "daily", week: "weekly", month: "monthly", year: "yearly" } as const;

function dayCode(word: string): Weekday | null {
  const w = word.toLowerCase();
  return DAY_WORDS.find(([re]) => re.test(w))?.[1] ?? null;
}

/** Finds a repeat rule and returns it with the text that expressed it. */
export function findRepeat(text: string): { repeat: Repeat; matched: string } | null {
  let m = text.match(/\bevery\s+(?:week)?day\b(?!s)|\bon\s+weekdays\b|\bweekdays\b/i);
  if (m && !/\bevery\s+day\b/i.test(m[0])) {
    return { repeat: { freq: "weekly", interval: 1, weekdays: ["MO", "TU", "WE", "TH", "FR"] }, matched: m[0] };
  }

  m = text.match(new RegExp(`\\bevery\\s+(${DAY}(?:\\s*(?:,|and|&)\\s*${DAY})*)`, "i"));
  if (m) {
    const days = m[1]
      .split(/\s*(?:,|and|&)\s*/i)
      .map(dayCode)
      .filter((d): d is Weekday => d !== null);
    if (days.length) return { repeat: { freq: "weekly", interval: 1, weekdays: [...new Set(days)] }, matched: m[0] };
  }

  m = text.match(/\bevery\s+(other\s+|(\d{1,3})\s+)?(day|week|month|year)s?\b/i);
  if (m) {
    const interval = m[1]?.trim().toLowerCase() === "other" ? 2 : m[2] ? Number(m[2]) : 1;
    const unit = m[3].toLowerCase() as keyof typeof UNIT_FREQ;
    return { repeat: { freq: UNIT_FREQ[unit], interval }, matched: m[0] };
  }

  m = text.match(/\bevery\s+(morning|evening|night|afternoon)\b/i);
  if (m) return { repeat: { freq: "daily", interval: 1 }, matched: "every" };

  m = text.match(/\b(daily|weekly|monthly|yearly|annually)\b/i);
  if (m) {
    const word = m[1].toLowerCase();
    const freq = word === "annually" ? "yearly" : (word as Repeat["freq"]);
    return { repeat: { freq, interval: 1 }, matched: m[0] };
  }
  return null;
}

const LEAD = /^\s*(?:hey\s+)?(?:please\s+)?(?:can you\s+)?(?:remind me(?:\s+to|\s+about|\s+that)?|set (?:a |an )?reminder(?:\s+to|\s+for|\s+about)?|add (?:a |an )?reminder(?:\s+to|\s+for)?|reminder(?:\s+to|:)?)\s*/i;
const EDGE_WORDS = /^(?:to|about|at|on|in|for|by|that|and|,|-)\s+|\s+(?:at|on|in|for|by|and|from|starting|,|-)$/i;

function cleanTitle(s: string): string {
  let t = s.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 5; i++) t = t.replace(EDGE_WORDS, "").trim();
  t = t.replace(/[.!?]+$/, "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

export function chronoRef(ctx: InterpretContext): chrono.ParsingReference {
  return { instant: ctx.now, timezone: offsetMinutes(ctx.now, ctx.timeZone) };
}

/** The zone's UTC offset in minutes at that moment, which is what chrono expects. */
export function offsetMinutes(at: Date, timeZone: string): number {
  return DateTime.fromJSDate(at, { zone: timeZone }).offset;
}

/** "the 5th" / "on the 21st" with no month: chrono doesn't read these. */
export const DAY_OF_MONTH = /\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i;

/** Rewrites "the 5th" as an explicit date: this month if still ahead, else next month. */
export function normalizeDayOfMonth(when: string, ctx: InterpretContext): string {
  const m = when.match(DAY_OF_MONTH);
  if (!m) return when;
  const day = Number(m[1]);
  if (day < 1 || day > 31) return when;
  const now = DateTime.fromJSDate(ctx.now, { zone: ctx.timeZone });
  let month = now.day <= day ? now : now.plus({ months: 1 });
  // Skip months that are too short (e.g. the 31st in November).
  while (month.daysInMonth! < day) month = month.plus({ months: 1 });
  return when.replace(m[0], `on ${month.toFormat("LLLL")} ${day} ${month.year}`);
}

function findWhen(text: string, ctx: InterpretContext): string {
  const r = chrono.parse(text, chronoRef(ctx), { forwardDate: true })[0];
  const dom = text.match(DAY_OF_MONTH)?.[0];
  if (!dom) return r?.text ?? "";
  // Keep "on the 5th" together with any time chrono found ("at 10am").
  return [dom, r?.text].filter(Boolean).join(" ").trim();
}

export function interpretWithRules(input: string, ctx: InterpretContext): Intent {
  const text = input.trim();
  const lower = text.toLowerCase();

  // Listing: "what's coming up", "show my reminders", "what do I have tomorrow"
  if (
    /^(?:what(?:'s| is)?|show|list|any|anything|do i have)\b/.test(lower) &&
    /\b(?:reminders?|coming up|upcoming|scheduled|do i have|on (?:today|tomorrow)|agenda|planned|on my plate)\b/.test(lower)
  ) {
    const range = /\btoday\b|\btonight\b/.test(lower)
      ? "today"
      : /\btomorrow\b/.test(lower)
        ? "tomorrow"
        : /\b(?:this|next|the)\s+week\b|\bweek\b/.test(lower)
          ? "week"
          : "all";
    return { action: "list", range };
  }

  // Rescheduling: "move dentist to friday at 4pm"
  let m = text.match(/^(?:move|reschedule|change|push|shift)\s+(?:the\s+|my\s+)?(.+?)(?:\s+reminder)?\s+to\s+(.+)$/i);
  if (m) return { action: "reschedule", target: m[1].trim(), when: m[2].trim() };

  // Deleting: "delete the dentist reminder", "cancel gym"
  m = text.match(/^(?:delete|remove|cancel|drop|forget)\s+(?:the\s+|my\s+)?(.+?)(?:\s+reminders?)?[.!]?$/i);
  if (m) return { action: "delete", target: m[1].trim() };

  // Creating: anything with "remind", a recognisable time, or a repeat.
  const body = text.replace(LEAD, "");
  const rep = findRepeat(body);
  const withoutRepeat = rep ? body.replace(rep.matched, " ") : body;
  const when = findWhen(withoutRepeat, ctx);
  if (!LEAD.test(text) && !when && !rep) return { action: "unknown" };

  let rest = withoutRepeat;
  for (const part of [withoutRepeat.match(DAY_OF_MONTH)?.[0], chrono.parse(withoutRepeat, chronoRef(ctx), { forwardDate: true })[0]?.text])
    if (part) rest = rest.replace(part, " ");
  const title = cleanTitle(rest);
  return { action: "create", title, when, repeat: rep?.repeat ?? null };
}

export const ruleBasedProvider: AIProvider = {
  name: "rules",
  async interpret(text, ctx) {
    return interpretWithRules(text, ctx);
  },
};
