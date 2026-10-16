"use server";

import { revalidatePath } from "next/cache";
import { DateTime, IANAZone } from "luxon";
import { z } from "zod";
import { removeSubscription, saveSubscription } from "@/lib/push/data";
import { insertReminder } from "@/lib/reminders/data";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(2000),
  keys: z.object({ p256dh: z.string().min(80).max(100), auth: z.string().min(16).max(30) }),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveDeviceAction(subscription: unknown, userAgent: string): Promise<ActionResult> {
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) return { ok: false, error: "The browser returned an unusable subscription." };
  try {
    const { endpoint, keys } = parsed.data;
    await saveSubscription(endpoint, keys.p256dh, keys.auth, userAgent.slice(0, 500) || null);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save this device." };
  }
  revalidatePath("/reminders");
  return { ok: true };
}

export async function removeDeviceAction(endpoint: string): Promise<ActionResult> {
  try {
    await removeSubscription(endpoint);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove this device." };
  }
  revalidatePath("/reminders");
  return { ok: true };
}

/** Creates a one-off reminder that is due now, so the next dispatcher run sends it. */
export async function sendTestAction(timeZone: string): Promise<ActionResult> {
  const zone = IANAZone.isValidZone(timeZone) ? timeZone : "UTC";
  const now = DateTime.now().setZone(zone).startOf("minute");
  try {
    await insertReminder({
      title: "Test notification",
      notes: "If you can read this, reminders reach this device.",
      start_local: now.toFormat("yyyy-LL-dd'T'HH:mm:ss"),
      time_zone: zone,
      recurrence: null,
      rrule: null,
      next_fire_at: new Date().toISOString(),
      status: "active",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the test reminder." };
  }
  revalidatePath("/reminders");
  return { ok: true };
}
