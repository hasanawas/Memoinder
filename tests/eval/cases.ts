// Phrases with the exact result we expect, used to measure how well a
// provider understands people. Reference time: Friday 16 Oct 2026, 13:00,
// Asia/Karachi. Add your own phrasings here.

export interface EvalCase {
  text: string;
  expect:
    | { action: "create"; title: RegExp; start: string; repeat?: string }
    | { action: "list"; range: string }
    | { action: "delete" | "reschedule"; target: RegExp }
    | { action: "clarify" };
}

export const CASES: EvalCase[] = [
  { text: "remind me to call the bank tomorrow at 9am", expect: { action: "create", title: /bank/i, start: "2026-10-17T09:00" } },
  { text: "Remind me to pay rent on oct 20 at 3pm", expect: { action: "create", title: /rent/i, start: "2026-10-20T15:00" } },
  { text: "water the plants in 2 hours", expect: { action: "create", title: /plants/i, start: "2026-10-16T15:00" } },
  { text: "dentist next friday at 4:30pm", expect: { action: "create", title: /dentist/i, start: "2026-10-23T16:30" } },
  { text: "take out the trash tonight at 8", expect: { action: "create", title: /trash/i, start: "2026-10-16T20:00" } },
  { text: "gym every monday and thursday at 7am", expect: { action: "create", title: /gym/i, start: "2026-10-19T07:00", repeat: "weekly:MO,TH" } },
  { text: "take vitamins every day at 8am", expect: { action: "create", title: /vitamin/i, start: "2026-10-17T08:00", repeat: "daily" } },
  // "8:00" could be morning or evening, so asking is the right answer.
  { text: "take vitamins every day at 8:00", expect: { action: "clarify" } },
  { text: "pay credit card bill every month on the 5th at 10am", expect: { action: "create", title: /credit card/i, start: "2026-11-05T10:00", repeat: "monthly" } },
  { text: "rent is due next friday, ping me at 10am", expect: { action: "create", title: /rent/i, start: "2026-10-23T10:00" } },
  { text: "don't let me forget mum's birthday on 2 November at 9 in the morning", expect: { action: "create", title: /birthday/i, start: "2026-11-02T09:00" } },
  { text: "call mum tomorrow at 5", expect: { action: "clarify" } },
  { text: "remind me to stretch", expect: { action: "clarify" } },
  { text: "what's coming up this week?", expect: { action: "list", range: "week" } },
  { text: "what do I have tomorrow", expect: { action: "list", range: "tomorrow" } },
  { text: "anything on my plate today?", expect: { action: "list", range: "today" } },
  { text: "delete the dentist reminder", expect: { action: "delete", target: /dentist/i } },
  { text: "I no longer need the gym reminder, get rid of it", expect: { action: "delete", target: /gym/i } },
  { text: "move the dentist to friday at 4pm", expect: { action: "reschedule", target: /dentist/i } },
];
