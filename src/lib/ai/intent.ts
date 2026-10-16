import { z } from "zod";
import { WEEKDAYS } from "@/lib/engine";

// The contract between any AI provider and the reminder engine.
//
// A provider only says WHAT the user wants, using the user's own words for
// times ("next friday at 5pm"). It never calculates dates: the app does that
// deterministically in resolve.ts, so a model's arithmetic can't be wrong.

export const repeatSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(999).default(1),
  weekdays: z.array(z.enum(WEEKDAYS)).optional(),
});

export const intentSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    title: z.string().max(200),
    /** The user's words for when, e.g. "tomorrow at 9am". Empty if none. */
    when: z.string().max(200),
    repeat: repeatSchema.nullable(),
  }),
  z.object({
    action: z.literal("list"),
    range: z.enum(["today", "tomorrow", "week", "all"]),
  }),
  z.object({
    action: z.literal("delete"),
    /** Words identifying the reminder, e.g. "dentist". */
    target: z.string().max(200),
    /** Set by the app when the user picks one of several matches. */
    targetId: z.string().optional(),
  }),
  z.object({
    action: z.literal("reschedule"),
    target: z.string().max(200),
    targetId: z.string().optional(),
    when: z.string().max(200),
  }),
  z.object({ action: z.literal("unknown") }),
]);

export type Repeat = z.infer<typeof repeatSchema>;
export type Intent = z.infer<typeof intentSchema>;

export interface InterpretContext {
  now: Date;
  timeZone: string;
}

/**
 * Anything that can turn a chat message into an Intent. Swapping the local
 * model (or adding a hosted one later) means writing another implementation;
 * nothing downstream changes.
 */
export interface AIProvider {
  readonly name: string;
  interpret(text: string, ctx: InterpretContext): Promise<Intent>;
}
