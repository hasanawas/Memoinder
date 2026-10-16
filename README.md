# Memoinder

A personal AI reminder assistant built entirely on free tiers and open-source software. It is also a learning project for full-stack development.

- Architecture, verified free-tier limits and the $0 cost conditions: [docs/architecture.md](docs/architecture.md)
- Current phase: **4, notifications**. You can sign in, create reminders by chatting or with a form, list, edit, move and delete them (including repeats), and get them as notifications with no Memoinder tab open. An optional local AI model (Ollama) understands looser phrasing. Free deployment comes in Phase 5.
- How the pieces work: [docs/engine.md](docs/engine.md) (dates and repeats), [docs/database.md](docs/database.md) (schema, access rules, Supabase setup), [docs/local-ai.md](docs/local-ai.md) (chat, Ollama set-up, accuracy), [docs/notifications.md](docs/notifications.md) (Web Push, delivery status, what is and is not tested)

## Requirements

- Node.js 20.9 or newer (22 recommended) and npm
- A container runtime for the local Supabase stack: Docker Desktop (free for personal use), OrbStack, Rancher Desktop or Podman
- No accounts or API keys are needed for local development

## Run it locally

```bash
npm install
npx supabase start     # local Postgres + Auth in containers (first run downloads images)
cp .env.example .env.local
npx supabase status    # copy API_URL and PUBLISHABLE_KEY into .env.local
npm run dev            # http://localhost:3000, then "Open my reminders"
```

For notifications, also follow the one-time setup in [docs/notifications.md](docs/notifications.md#run-it-locally) and run `npx supabase functions serve` in another terminal.

Create an account on the sign-in page with any email; locally no email is sent.

## Checks

| Command | What it does |
|---|---|
| `npm run typecheck` | Generates Next.js route types, then runs the TypeScript compiler |
| `npm run lint` | ESLint with the Next.js rules |
| `npm test` | Unit tests with Vitest (`src/**/*.test.ts`) |
| `npm run test:db` | Database tests against the local Supabase (`tests/db`): access rules, sending, and the every-minute schedule; needs `npx supabase start` (the schedule test also needs `npx supabase functions serve`, and is skipped without it) |
| `npm run push:keys` | Prints a new VAPID key pair for Web Push |
| `npm run eval:ai` | Scores the chat parsers on sample phrases; add `OLLAMA_MODEL=llama3.2:3b` to include your local model |
| `npm run test:e2e` | Builds the app, starts it on port 3100 and runs Playwright browser tests (`tests/e2e`); needs local Supabase |

The first time you run end-to-end tests on your own computer, install the browser once with `npx playwright install chromium`.

GitHub Actions runs all of these on every pull request, with a throwaway local Supabase inside the runner (`.github/workflows/ci.yml`). Actions minutes on standard runners are free for public repositories.

## Project layout

```
src/app/        Next.js App Router pages (login, reminders)
src/proxy.ts    Refreshes the session and guards signed-in pages
src/lib/        Plain TypeScript logic (unit-tested)
src/lib/engine/ Reminder engine: schedules, repeats, due rules
src/lib/reminders/ Form parsing and the data access layer
src/lib/ai/      Chat providers: built-in parser and Ollama
src/lib/chat/    Turns chat intents into exact schedules (no AI)
src/lib/push/    Web Push encryption + VAPID, devices and delivery history
src/lib/dispatch/ What the delivery worker sends and records
public/sw.js    Service Worker: shows notifications, confirms them
supabase/       Local Supabase config, SQL migrations, Edge Function
tests/db/       Database access-rule tests
tests/e2e/      Playwright browser tests
docs/           Architecture and decisions
```

## Known warnings

`npm audit` reports high-severity advisories in `braces`, pulled in by `eslint-config-next`. It is a development-only lint dependency and is not shipped to the browser or server. The suggested `npm audit fix --force` would downgrade the Next.js lint config to version 14, so it is intentionally not applied.
