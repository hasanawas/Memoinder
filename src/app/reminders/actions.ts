import { draftToRow, parseForm, readForm, type FieldErrors, type FormValues } from "@/lib/reminders/form";
import { deleteReminder, insertReminder, updateReminder } from "@/lib/reminders/data";

// Form handlers. They run in the browser; the database re-checks everything
// that matters (ownership, valid time zone, sizes) on its side.

export interface ReminderFormState {
  errors?: FieldErrors;
  values?: FormValues;
  attempt: number;
  /** Set when the reminder was saved and the form can go back to the list. */
  saved?: boolean;
}

async function save(prev: ReminderFormState, fd: FormData, id: string | null): Promise<ReminderFormState> {
  const values = readForm(fd);
  const fail = (errors: FieldErrors) => ({ errors, values, attempt: prev.attempt + 1 });

  const parsed = parseForm(values);
  if (!parsed.ok) return fail(parsed.errors);
  const built = draftToRow(parsed.draft, new Date());
  if (!built.ok) return fail(built.errors);

  try {
    if (id) {
      const changed = await updateReminder(id, built.row);
      if (!changed) return fail({ form: "That reminder no longer exists." });
    } else {
      await insertReminder(built.row);
    }
  } catch (e) {
    return fail({ form: e instanceof Error ? e.message : "Could not save the reminder." });
  }
  return { values, attempt: prev.attempt, saved: true };
}

export async function createReminderAction(prev: ReminderFormState, fd: FormData) {
  return save(prev, fd, null);
}

export async function updateReminderAction(id: string, prev: ReminderFormState, fd: FormData) {
  return save(prev, fd, id);
}

export async function deleteReminderAction(id: string) {
  await deleteReminder(id);
}
