"use server";

import { revalidatePath } from "next/cache";
import { DateTime, IANAZone } from "luxon";
import { z } from "zod";
import { describeSchedule, scheduleSchema } from "@/lib/engine";
import { intentSchema, type InterpretContext } from "@/lib/ai/intent";
import {
  listInRange,
  matchReminders,
  proposeCreate,
  proposeReschedule,
  type Clarify,
  type Proposal,
} from "@/lib/chat/resolve";
import { deleteReminder, getReminder, insertReminder, listReminders, updateReminder } from "@/lib/reminders/data";
import { draftToRow, rowToSchedule, type ReminderRow } from "@/lib/reminders/form";

// Server side of the chat. The browser sends an Intent (from the local model
// or the rule parser); everything here re-validates it, because anything from
// the browser can be tampered with. Nothing is saved until the user confirms.

export interface ListItem {
  id: string;
  title: string;
  next: string;
  summary: string;
}

export type ChatReply =
  | { kind: "proposal-create"; proposal: Proposal }
  | { kind: "proposal-reschedule"; id: string; title: string; proposal: Proposal }
  | { kind: "proposal-delete"; id: string; title: string; next: string | null }
  | { kind: "list"; heading: string; items: ListItem[] }
  | Clarify
  | { kind: "message"; text: string };

function context(timeZone: string): InterpretContext {
  if (!IANAZone.isValidZone(timeZone)) throw new Error("Unknown time zone");
  return { now: new Date(), timeZone };
}

const fmt = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toFormat("ccc d LLL, HH:mm");

const RANGE_HEADING = { today: "Later today", tomorrow: "Tomorrow", week: "In the next 7 days", all: "Upcoming" };

async function findTarget(
  intent: { target: string; targetId?: string },
): Promise<{ row: ReminderRow } | { many: ReminderRow[] } | { none: true }> {
  if (intent.targetId) {
    const row = await getReminder(intent.targetId);
    return row ? { row } : { none: true };
  }
  const rows = (await listReminders()).filter((r) => r.status === "active");
  const found = matchReminders(intent.target, rows);
  if (found.length === 1) return { row: found[0] };
  if (found.length > 1) return { many: found };
  return { none: true };
}

export async function respond(rawIntent: unknown, timeZone: string): Promise<ChatReply> {
  const parsed = intentSchema.safeParse(rawIntent);
  if (!parsed.success) return { kind: "message", text: "Sorry, I couldn't understand that request." };
  const intent = parsed.data;
  const ctx = context(timeZone);

  switch (intent.action) {
    case "create": {
      const r = proposeCreate(intent, ctx);
      return r.kind === "proposal" ? { kind: "proposal-create", proposal: r.proposal } : r;
    }
    case "list": {
      const items = listInRange(await listReminders(), intent.range, ctx).map((r) => ({
        id: r.id,
        title: r.title,
        next: fmt(r.next_fire_at!, r.time_zone),
        summary: describeSchedule(rowToSchedule(r)),
      }));
      return { kind: "list", heading: RANGE_HEADING[intent.range], items };
    }
    case "delete":
    case "reschedule": {
      const t = await findTarget(intent);
      if ("none" in t) return { kind: "message", text: `I couldn't find an active reminder matching "${intent.target}".` };
      if ("many" in t) {
        return {
          kind: "clarify",
          need: "which",
          question: `Which one do you mean?`,
          pending: intent,
          options: t.many.slice(0, 6).map((r) => ({
            label: `${r.title} (${r.next_fire_at ? fmt(r.next_fire_at, r.time_zone) : "no more times"})`,
            intent: { ...intent, targetId: r.id },
          })),
        };
      }
      const row = t.row;
      if (intent.action === "delete") {
        return {
          kind: "proposal-delete",
          id: row.id,
          title: row.title,
          next: row.next_fire_at ? fmt(row.next_fire_at, row.time_zone) : null,
        };
      }
      const r = proposeReschedule(intent, row, ctx);
      return r.kind === "proposal" ? { kind: "proposal-reschedule", id: row.id, title: row.title, proposal: r.proposal } : r;
    }
    default:
      return {
        kind: "message",
        text: 'I can create, list, move and delete reminders. Try "remind me to call mum tomorrow at 6pm", "what\'s coming up this week?", "move gym to friday at 7am" or "delete the dentist reminder".',
      };
  }
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).nullable(),
  schedule: scheduleSchema,
});

export type ConfirmResult = { ok: true; text: string } | { ok: false; text: string };

async function saveDraft(rawDraft: unknown, id: string | null): Promise<ConfirmResult> {
  const d = draftSchema.safeParse(rawDraft);
  if (!d.success) return { ok: false, text: "That reminder was not valid; nothing was saved." };
  const built = draftToRow(d.data, new Date());
  if (!built.ok) return { ok: false, text: `Not saved: ${Object.values(built.errors)[0]}` };
  if (id) {
    if (!(await updateReminder(id, built.row))) return { ok: false, text: "That reminder no longer exists." };
  } else {
    await insertReminder(built.row);
  }
  revalidatePath("/reminders");
  return { ok: true, text: `Saved "${d.data.title}". ${describeSchedule(d.data.schedule)}.` };
}

export async function confirmCreate(draft: unknown): Promise<ConfirmResult> {
  return saveDraft(draft, null);
}

export async function confirmReschedule(id: string, draft: unknown): Promise<ConfirmResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, text: "Unknown reminder." };
  return saveDraft(draft, id);
}

export async function confirmDelete(id: string): Promise<ConfirmResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, text: "Unknown reminder." };
  const row = await getReminder(id);
  if (!row) return { ok: false, text: "That reminder no longer exists." };
  await deleteReminder(id);
  revalidatePath("/reminders");
  return { ok: true, text: `Deleted "${row.title}".` };
}
