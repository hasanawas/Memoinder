# The reminder engine (Phase 1)

`src/lib/engine/` is plain TypeScript with no database, network or framework code. The Next.js app and, in Phase 4, the Supabase Edge Function that sends notifications will both import it, so a reminder's next time is always calculated the same way. The AI model never does date arithmetic; it only hands phrases to this code (Phase 3).

## The idea: store wall-clock time plus a zone

A reminder is stored the way you think about it:

```ts
{ start: "2026-10-20T09:00", timeZone: "Asia/Karachi", recurrence: { freq: "weekly" } }
```

not as a UTC instant. If we stored `04:00Z` and added 7 days each time, a weekly reminder in a zone with daylight saving would drift by an hour twice a year. Keeping "09:00 in this zone" and converting to UTC only when we need an instant keeps it at 09:00 local time.

## Files

| File | What it does |
|---|---|
| `schedule.ts` | The `Schedule` type and its Zod validation (`parseSchedule`), plus `wallTimeToInstant` |
| `occurrences.ts` | Converts a schedule to an RFC 5545 RRULE and finds the next occurrence (`nextOccurrence`, `upcoming`, `toRRuleString`) |
| `due.ts` | What the dispatcher should do at a given moment (`classifyDue`, `advance`) |
| `describe.ts` | Plain-English summary for the UI (`describeSchedule`) |
| `engine.test.ts` | Unit tests for all of the above |

## Rules the tests pin down

**Daylight saving**
- A time that does not exist (clocks jump from 02:00 to 03:00) moves forward by the gap: 02:30 fires at 03:30, and only on that day.
- A time that happens twice (clocks fall back from 02:00 to 01:00) fires once, at the first one.

**Repeats**
- Daily, weekly (on chosen weekdays, defaulting to the start's weekday), monthly and yearly, each with an interval ("every 2 weeks").
- Monthly on the 29th to 31st fires on the last day of shorter months (31 Jan, 28 Feb, 31 Mar, 30 Apr). Plain RFC 5545 would skip those months, which is rarely what anyone means.
- Yearly on 29 Feb fires on 28 Feb in non-leap years.
- A repeat can end after `count` occurrences or on an `until` date (inclusive), not both.

**Delivery timing** (used by the dispatcher in Phase 4, which runs about once a minute)
- `on_time`: up to 2 minutes after the time.
- `late`: up to 24 hours after; still sent, marked late.
- `missed`: older than that; not sent, recorded as missed.
- After an outage, `advance` skips repeat occurrences that already passed instead of sending a burst, and returns them so they can be recorded as missed.

## How it works: "floating time"

The `rrule` library is good at repeat patterns but unreliable with real time zones. So `occurrences.ts` gives rrule the wall-clock time disguised as UTC (09:00 local becomes `09:00Z`). rrule then produces wall-clock results like "Monday 09:00", and Luxon converts each one into the real zone, applying that day's offset. That's why one rule gives `09:00Z` before London's clocks change and `08:00Z` after.

## Running the tests

```bash
npm test                         # all unit tests
npx vitest run src/lib/engine    # just the engine
TZ=Asia/Karachi npm test         # same results whatever your computer's zone is
```

CI runs the unit tests twice, in UTC and in `Pacific/Kiritimati` (UTC+14), to catch any code that accidentally uses the computer's own time zone.
