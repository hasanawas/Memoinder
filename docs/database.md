# Database and sign-in (Phase 2)

Memoinder stores reminders in Supabase Postgres and signs you in with Supabase Auth (an emailed 6-digit code). Both run on the Supabase **Free** plan when hosted, and entirely on your own computer during development.

## The `reminders` table

Defined in [`supabase/migrations/20261016000000_reminders.sql`](../supabase/migrations/20261016000000_reminders.sql).

| Column | Meaning |
|---|---|
| `user_id` | Owner. Defaults to the signed-in user; deleting the account deletes their reminders. |
| `title`, `notes` | Text, limited to 200 and 2000 characters. |
| `start_local` | Wall-clock start, `timestamp without time zone` on purpose (e.g. `2026-10-20 09:00`). |
| `time_zone` | IANA zone name. A trigger rejects names Postgres doesn't know. |
| `recurrence` | The repeat rule as JSON in the engine's shape (`{"freq":"weekly","interval":1,"weekdays":["MO"]}`), or null. |
| `rrule` | The same rule as RFC 5545 text, for reading and a future calendar export. |
| `next_fire_at` | The next notification time in UTC, calculated by the app's engine. Phase 4's dispatcher scans this column. |
| `status` | `active` or `completed`. An active reminder must have a `next_fire_at`. |

## Who can see what: Row Level Security

The browser talks to Supabase with a **publishable key** that anyone can read from the page source. That is safe only because the database checks every query:

- Each signed-in user can select, insert, update and delete only rows where `user_id` is their own id.
- Signed-out visitors have no access to the table at all.

`tests/db/rls.test.ts` proves this by creating two users and checking that one cannot read, change, delete or forge the other's reminders.

## How the app uses it

- `src/proxy.ts` runs before each page, refreshes the session cookie and sends signed-out visitors to `/login`.
- `src/lib/reminders/data.ts` is the only code that queries reminders. It re-checks the session every time.
- `src/lib/reminders/form.ts` turns the form into an engine schedule and a row, including `next_fire_at`. It refuses one-off times that have already passed.
- Pages: `/login`, `/reminders` (upcoming and finished), `/reminders/new`, `/reminders/[id]/edit`. Delete is a button on the list.

## Local development

You need a container runtime that the Supabase CLI supports: Docker Desktop (free for personal use), OrbStack, Rancher Desktop, Podman or colima.

```bash
npx supabase start        # first run downloads images; later runs take seconds
cp .env.example .env.local
npx supabase status       # copy API_URL and PUBLISHABLE_KEY into .env.local
npm run dev               # http://localhost:3000
```

Local sign-up does not send real email and needs no confirmation. To wipe the local database and re-apply migrations: `npx supabase db reset`. To stop everything: `npx supabase stop`.

## Hosted Supabase (free plan) when you're ready

Nothing in this phase needs a hosted project. When you want one (Phase 5 at the latest):

1. Sign up at supabase.com and create a project on the **Free** plan. Do not add a payment method.
2. Apply the schema: `npx supabase login`, `npx supabase link --project-ref <your-ref>`, `npx supabase db push`. Or paste the migration file into the dashboard's SQL editor.
3. Put the project URL and publishable key (Project Settings > API Keys) in `.env.local`.
4. **Create your account, then turn sign-ups off** with the "Allow new users to sign up" switch in the dashboard's Authentication settings. Memoinder is personal; this stops strangers creating accounts on your project.
5. Leave "Confirm email" on. Confirming your one account uses one of the built-in sender's **2 emails per hour**.

Free-plan limits that matter here: 500 MB database, 2 active projects, and projects with low activity for 7 days are paused (restorable without data loss). See [architecture.md](architecture.md#3-free-tier-limits-verified).
