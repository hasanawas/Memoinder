import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import type { Intent, InterpretContext } from "@/lib/ai/intent";
import { chronoRef, normalizeDayOfMonth } from "@/lib/ai/rules";

// The chat's short-term memory and small talk. Everything here is plain,
// offline code (no AI model): it lets the chat follow on from what was just
// said ("make it 7pm", "delete it") and answer "hi" or "thanks" like a person,
// without repeating the same sentence every time.

export interface ChatMemory {
  /** How often each kind of canned reply was used, so the next one differs. */
  used: Record<string, number>;
  /** The reminder the conversation is about right now. */
  lastReminder?: { id: string; title: string; when?: string };
  /** A reminder proposed but not yet saved. */
  pendingCreate?: Extract<Intent, { action: "create" }>;
}

export const emptyMemory = (): ChatMemory => ({ used: {} });

/** Picks the next reply of a kind, rotating so the same words don't come back to back. */
export function pick(memory: ChatMemory, kind: string, options: readonly string[]): string {
  const n = memory.used[kind] ?? 0;
  memory.used[kind] = n + 1;
  return options[n % options.length];
}

const REPLIES = {
  greeting: [
    "Hi! What would you like me to remind you about?",
    "Hello! Tell me what to remember and when.",
    "Hey there. Anything coming up I should keep track of?",
  ],
  thanks: ["You're welcome!", "Any time.", "Happy to help.", "No problem."],
  ack: ["Great.", "Sounds good.", "Okay!", "Got it."],
  howAreYou: [
    "All good here, and ready to remember things so you don't have to. What's on your list?",
    "Doing well, thanks! Is there something you'd like a reminder for?",
  ],
  whoAreYou: [
    "I'm Memoinder, your reminder assistant. Tell me things like \"call mum tomorrow at 6pm\" and I'll set them up, then notify you on time.",
    "I'm Memoinder. I turn everyday sentences into reminders and send you a notification when they're due.",
  ],
  help: [
    "You can talk to me normally. For example:\n• \"remind me to call mum tomorrow at 6pm\"\n• \"gym every Monday and Thursday at 7am\"\n• \"what's coming up this week?\"\n• \"move the dentist to Friday at 4pm\"\n• \"delete the gym reminder\"\nAfter I suggest a reminder you can also say \"make it 7pm\" or \"delete it\".",
    "I handle reminders: creating, listing, moving and deleting them. Try \"what do I have tomorrow?\" or \"pay rent every month on the 1st at 9am\".",
  ],
  bye: ["Bye for now! Your reminders will still arrive.", "See you! I'll keep an eye on the time."],
  unknown: [
    "I didn't catch a reminder in that. Could you say what and when, like \"water the plants on Sunday at 10am\"?",
    "Hmm, I'm not sure what to do with that. I'm best at reminders: try \"remind me to stretch in 2 hours\".",
    "I only understand reminder requests, so I may have missed your point. Something like \"what's coming up this week?\" works.",
  ],
  nothingToRefer: [
    "Which reminder do you mean? Tell me its name, like \"delete the dentist reminder\".",
    "I'm not sure which reminder you mean. Could you name it?",
  ],
} as const;

export type ReplyKind = keyof typeof REPLIES;

const SMALL_TALK: [ReplyKind, RegExp][] = [
  ["thanks", /^(?:(?:ok(?:ay)?|great|perfect|awesome|nice|cool|good)[,!. ]*)?(?:thanks|thank you|thx|ty|cheers|thanks a lot|many thanks|shukriya|jazakallah)\b.*$/i],
  ["ack", /^(?:ok(?:ay)?|k|great|perfect|awesome|nice|cool|good|got it|alright|sure|fine|yes|yep|yeah|no worries|👍|🙂|😊)[\s!.]*$/i],
  ["bye", /^(?:bye|goodbye|good night|gn|see you|see ya|later|cya)\b[\s!.]*.*$/i],
  ["howAreYou", /\b(?:how are you|how're you|how r u|how's it going|how is it going|how do you do|what'?s up|wassup)\b/i],
  ["whoAreYou", /\b(?:who are you|what are you|your name|who made you|are you (?:a bot|an ai|human|real))\b/i],
  ["help", /^(?:help|\?|what can you do|what do you do|how does this work|how do i use (?:this|you)|commands|examples?|what can i (?:say|ask))\b.*$/i],
  [
    "greeting",
    /^(?:hi|hello|hey|hiya|howdy|yo|hola|salam|salaam|assalam[ou]?\s*[ao]?laikum|good\s+(?:morning|afternoon|evening))\b[\s!.,]*(?:there|memoinder|bot)?[\s!.]*$/i,
  ],
];

/** Small talk that needs no reminder action, or null. */
export function smallTalk(text: string): ReplyKind | null {
  const t = text.trim();
  for (const [kind, re] of SMALL_TALK) if (re.test(t)) return kind;
  return null;
}

export function replyFor(memory: ChatMemory, kind: ReplyKind): string {
  return pick(memory, kind, REPLIES[kind]);
}

const PRONOUN = /^(?:it|that|this|that one|this one|the last one|the one i just (?:made|added|created)|same)$/i;
const SOFT = "(?:(?:no|nope|actually|sorry|oh|wait|hmm|ok(?:ay)?|please)[,.!]?\\s+)*";
const CHANGE_WHEN = new RegExp(
  `^${SOFT}(?:make it|change it(?: to)?|move it(?: to)?|set it(?: to| for)?|do it|let'?s do|let'?s say|how about|what about|rather|instead)\\s+(.+?)(?:\\s+instead)?[.!?]*$`,
  "i",
);
const INSTEAD = new RegExp(`^${SOFT}(.+?)\\s+instead[.!?]*$`, "i");
const CORRECTION = /^(?:(?:no|nope|actually|sorry|wait)[,.!]?\s+)+(.+?)[.!?]*$/i;

function looksLikeTime(text: string, ctx: InterpretContext): boolean {
  const r = chrono.parse(text, chronoRef(ctx), { forwardDate: true })[0];
  // Mostly a time or date, not a whole new request.
  return Boolean(r) && r.text.length >= text.replace(/^(?:at|on|for)\s+/i, "").length - 3;
}

/** "make it 7pm", "friday instead", "no, 8am" -> the new time words, or null. */
export function followUpWhen(text: string, ctx: InterpretContext): string | null {
  const t = text.trim();
  const m = t.match(CHANGE_WHEN) ?? t.match(INSTEAD) ?? t.match(CORRECTION);
  if (!m) return null;
  return looksLikeTime(m[1], ctx) ? m[1].trim() : null;
}

/**
 * Combines a new time with the date already being discussed:
 * ("tomorrow at 6pm", "7pm") -> "October 17 2026 7pm". A new date wins.
 */
export function mergeWhen(oldWhen: string | undefined, newWhen: string, ctx: InterpretContext): string {
  const next = chrono.parse(newWhen, chronoRef(ctx), { forwardDate: true })[0];
  if (!next || !oldWhen) return newWhen;
  const hasDate = next.start.isCertain("day") || next.start.isCertain("weekday") || /\b(?:today|tonight|tomorrow)\b/i.test(newWhen);
  if (hasDate) {
    // A new day without a time keeps the old time: "friday instead" of "tomorrow at 6pm".
    if (next.start.isCertain("hour")) return newWhen;
    const old = chrono.parse(oldWhen, chronoRef(ctx), { forwardDate: true })[0];
    return old?.start.isCertain("hour") ? `${newWhen} at ${old.start.get("hour")}:${String(old.start.get("minute") ?? 0).padStart(2, "0")}` : newWhen;
  }
  const old = chrono.parse(normalizeDayOfMonth(oldWhen, ctx), chronoRef(ctx), { forwardDate: true })[0];
  if (!old) return newWhen;
  const day = DateTime.fromObject(
    { year: old.start.get("year")!, month: old.start.get("month")!, day: old.start.get("day")! },
    { zone: ctx.timeZone },
  );
  return `${day.toFormat("LLLL d yyyy")} ${newWhen.replace(/^at\s+/i, "at ")}`;
}

/**
 * What the chat should do with a message before the parser sees it:
 * a small-talk reply, an intent rebuilt from the conversation, or nothing.
 */
export function beforeParse(
  text: string,
  memory: ChatMemory,
  ctx: InterpretContext,
): { reply: string } | { intent: Intent } | null {
  const when = followUpWhen(text, ctx);
  if (when) {
    if (memory.pendingCreate) {
      const p = memory.pendingCreate;
      return { intent: { ...p, when: mergeWhen(p.when, when, ctx) } };
    }
    if (memory.lastReminder) {
      const r = memory.lastReminder;
      return { intent: { action: "reschedule", target: r.title, targetId: r.id, when: mergeWhen(r.when, when, ctx) } };
    }
  }
  const kind = smallTalk(text);
  return kind ? { reply: replyFor(memory, kind) } : null;
}

/** Fills in "it"/"that" with the reminder the conversation is about. */
export function afterParse(intent: Intent, memory: ChatMemory, ctx: InterpretContext): Intent | { reply: string } {
  if ((intent.action === "delete" || intent.action === "reschedule") && !intent.targetId && PRONOUN.test(intent.target.trim())) {
    const r = memory.lastReminder;
    if (!r) return { reply: replyFor(memory, "nothingToRefer") };
    if (intent.action === "delete") return { ...intent, target: r.title, targetId: r.id };
    return { ...intent, target: r.title, targetId: r.id, when: mergeWhen(r.when, intent.when, ctx) };
  }
  if (intent.action === "unknown") return { reply: replyFor(memory, "unknown") };
  return intent;
}
