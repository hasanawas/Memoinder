import type { Schedule } from "./schedule.ts";
import { nextOccurrence } from "./occurrences.ts";

// Decides what the dispatcher should do with a reminder whose time has come.
// The dispatcher runs about once a minute, so "on time" allows some slack.

export type DueState = "pending" | "on_time" | "late" | "missed";

export interface DuePolicy {
  /** Sent within this long after its time counts as on time. */
  graceMs: number;
  /** Older than this is not sent at all and is recorded as missed. */
  missedAfterMs: number;
}

export const DEFAULT_POLICY: DuePolicy = {
  graceMs: 2 * 60_000,
  missedAfterMs: 24 * 60 * 60_000,
};

export function classifyDue(fireAt: Date, now: Date, policy: DuePolicy = DEFAULT_POLICY): DueState {
  const age = now.getTime() - fireAt.getTime();
  if (age < 0) return "pending";
  if (age <= policy.graceMs) return "on_time";
  if (age <= policy.missedAfterMs) return "late";
  return "missed";
}

export interface Advance {
  /** When to fire next, or null when the reminder is finished. */
  next: Date | null;
  /** Occurrences between the one just handled and now that will not be sent. */
  skipped: Date[];
}

/**
 * After the occurrence at `handled` was sent (or marked missed), work out the
 * next one. If the system was down for a while, occurrences that already
 * passed are skipped rather than sent in a burst; they are returned so the
 * caller can record them as missed.
 */
export function advance(schedule: Schedule, handled: Date, now: Date): Advance {
  const skipped: Date[] = [];
  let next = nextOccurrence(schedule, handled);
  while (next && next <= now) {
    skipped.push(next);
    next = nextOccurrence(schedule, next);
    if (skipped.length > 1000) throw new Error("advance skipped too many occurrences");
  }
  return { next, skipped };
}
