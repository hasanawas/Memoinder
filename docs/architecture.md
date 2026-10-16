# Memoinder: $0 Architecture Proposal

_Prepared 2026-10-16. All limits below were checked against official docs on that date (links in each section). Free tiers change; re-check before deploying._

> **Update (Phase 5, 2026-10-16):** at your request the site is hosted on **GitHub Pages** instead of Vercel Hobby. Pages serves static files only, so the app became a static Next.js export that talks to Supabase from the browser (Row Level Security was already the real protection), and sign-in switched from email + password to an **emailed 6-digit code**, because GitHub asks Pages sites not to handle passwords. The 2-emails-per-hour limit below now applies to sign-ins; a session lasts until you sign out, so that is enough for one person. Setup and the cost checklist: [deploy.md](deploy.md). The Vercel sections below are kept for the record.

## Starting point

The GitHub repository `hasanawas/Memoinder` exists but is **empty** (no commits). There is no existing code to review, so this proposal starts fresh.

## TL;DR

| Question | Answer |
|---|---|
| Monthly cost | **$0**, under the conditions in section 6 |
| Does my computer need to stay on for reminders to fire? | **No.** Scheduling and delivery run inside Supabase's cloud (Postgres `pg_cron` + an Edge Function). |
| When is my computer needed? | Only for the **optional** local AI (Ollama) when creating reminders by chat on that computer. Without it, a built-in deterministic parser and a form still work, including on a phone. |
| Payment method required? | None needed for any service in this plan. Never add one. |
| Paid AI API? | None. Local Ollama only, behind a swappable provider interface. |

---

## 1. Exact technology stack

| Layer | Choice | Licence / plan |
|---|---|---|
| Language | TypeScript (strict) | open source |
| Web framework | Next.js (App Router) | open source (MIT) |
| Styling | Tailwind CSS | open source (MIT) |
| Validation | Zod (validates AI output, API input) | open source (MIT) |
| Date/time | Luxon (IANA time zones) + `rrule` (recurrence, RFC 5545) | open source |
| Natural-language date fallback | `chrono-node` (deterministic parser, no AI) | open source (MIT) |
| Database | Supabase Postgres (Free plan) | free tier |
| Auth | Supabase Auth, **emailed 6-digit code** (was email + password before Phase 5) | free tier |
| Scheduler | `pg_cron` + `pg_net` inside Supabase Postgres | included in Supabase |
| Delivery worker | One Supabase Edge Function `dispatch-reminders` (Deno) | free tier |
| Notifications | Standard Web Push (VAPID keys, Push API, Service Worker) | free open standard |
| Local AI | Ollama + a small instruct model (default `llama3.2:3b`, upgrade `qwen2.5:7b`) | open source |
| Hosting | GitHub Pages, static export (was Vercel Hobby before Phase 5) | free for public repos |
| Source control + CI | GitHub Free, public repo, GitHub Actions for tests only | free tier |
| Tests | Vitest (unit), Playwright (end-to-end; Chromium already available) | open source |
| Local dev DB | Supabase CLI (runs Postgres locally in Docker) | open source |

## 2. Role of each service

- **Next.js app (Vercel Hobby):** UI (chat, reminder list, edit/delete, settings), API routes that validate input and write to the database, registers the Service Worker and the push subscription. It does **no** scheduling.
- **Supabase Postgres:** source of truth. Tables: `reminders` (title, notes, local wall time, IANA time zone, RRULE, `next_fire_at` in UTC, status), `push_subscriptions` (one per browser/device), `deliveries` (one row per send attempt with status). Row Level Security so each user only sees their own rows.
- **Supabase Auth:** sign-in, user id used by Row Level Security.
- **`pg_cron` + `pg_net`:** a cron job runs **every minute** inside the database and, only when a reminder is due, makes an HTTP POST to the Edge Function. This is Supabase's documented pattern ([Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)).
- **Edge Function `dispatch-reminders`:** claims due reminders, sends Web Push, records delivery results, computes the next occurrence for recurring reminders.
- **Browser push services** (Google FCM for Chrome/Edge, Mozilla autopush for Firefox, Apple for Safari): carry the encrypted message to the device. Using them via the Web Push standard needs no account and no fee.
- **Ollama (your computer):** turns chat text into a structured "action" (create / list / update / delete). Optional.
- **GitHub:** code hosting and CI test runs. Not used for scheduling (see section 7).

## 3. Free-tier limits (verified)

### Supabase Free ([pricing](https://supabase.com/pricing), [pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [cost control](https://supabase.com/docs/guides/platform/cost-control), [function limits](https://supabase.com/docs/guides/functions/limits), [auth rate limits](https://supabase.com/docs/guides/auth/rate-limits))

| Limit | Value | Our expected use |
|---|---|---|
| Database size | 500 MB per project | well under 10 MB for personal use |
| Monthly active users | 50,000 | 1 |
| Egress | 5 GB (+5 GB cached) | tiny |
| Edge Function invocations | 500,000 / month | every-minute cron = ~44,640 / month (~9%) |
| Edge Function CPU | 2 s per request (async I/O excluded), 150 s wall clock, 256 MB | a few ms per run |
| Active projects | 2 | 1 |
| Built-in auth emails | **2 emails per hour** per project | why we use email + password, not magic links |
| **Pausing** | Free projects with low activity over 7 days are paused (warning email ~1 week before). Restorable for up to 1 year. | see risk below |
| Overage | Docs: "you will not be charged while using the Free Plan." | $0 |

**Pausing risk:** Supabase's docs define inactivity as not enough "user database activity" and list API calls as a way to prevent pausing. They do not say whether `pg_cron` traffic counts. The dispatcher only calls into the project in minutes when a reminder is due (Phase 4 chose this to save invocations), so regular use of the app is what keeps the project active. Pausing is unlikely if you open Memoinder at least weekly, but it is **inferred, not guaranteed**. Mitigation: a pause is reversible with no data loss (click "Resume" in the dashboard), and the warning email arrives first. While paused, reminders do **not** fire.

### Vercel Hobby ([Hobby plan](https://vercel.com/docs/plans/hobby), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing))

| Limit | Value |
|---|---|
| Function invocations | 1,000,000 / month |
| Active CPU | 4 CPU-hours / month |
| Fast Data Transfer | 100 GB / month |
| Deployments | 100 / day |
| Cron jobs | **once per day only, ±59 min precision** (unusable for reminders, so not used) |
| Use restriction | **Non-commercial, personal use only** |
| Overage | No billing cycle; exceeding a limit pauses the feature until 30 days pass. No card on file, so no charge. |

### Cloudflare Workers Free (backup option, not used initially) ([limits](https://developers.cloudflare.com/workers/platform/limits/))

100,000 requests/day, 10 ms CPU per invocation, 5 cron triggers per account. Requests over the limit fail with error 1027 rather than being billed. Kept as a fallback scheduler if Supabase cron ever proves unreliable.

### GitHub Free ([schedule docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule))

Public repo: free Actions minutes on standard runners for CI. Scheduled workflows: minimum every 5 minutes, "can be delayed during periods of high load", "some queued jobs may be dropped", and auto-disabled after 60 days without repo activity. **Too unreliable to be the reminder scheduler**, used only for running tests.

### Web Push

Open W3C standard; the browser vendors' push services require no sign-up for VAPID-based Web Push. Limits: payload ~4 KB, services may delay or drop messages for offline devices after the TTL we set. On iPhone/iPad, Web Push works only for a site **added to the Home Screen** (iOS/iPadOS 16.4+) ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).

## 4. Reminder-delivery architecture

```
 You (browser/PWA)                       Supabase cloud (runs 24/7, no computer needed)
 ─────────────────                       ───────────────────────────────────────────────
 Chat / form ──► Next.js API (Vercel) ──► reminders table
                                           (next_fire_at stored in UTC, computed from
                                            your wall-clock time + IANA zone + RRULE)

 "Enable notifications" ──► push_subscriptions table (endpoint + keys per device)

                                           pg_cron, every minute
                                              │ pg_net HTTP POST (secret from Vault)
                                              ▼
                                           Edge Function dispatch-reminders
                                              1. claim due rows atomically
                                                 (UPDATE … FOR UPDATE SKIP LOCKED,
                                                  so no double sends)
                                              2. for each device subscription:
                                                 send encrypted Web Push (VAPID)
                                              3. write deliveries row:
                                                 sent / failed / expired (404/410
                                                 → subscription removed)
                                              4. recurring? compute next_fire_at
                                                 with rrule + Luxon; else mark done
                                              │
                                              ▼
                                Browser push service (FCM / Mozilla / Apple)
                                              │
                                              ▼
 Service Worker on your device: shows notification even with all tabs closed,
 then POSTs an acknowledgement ──► deliveries.status = displayed (and clicked on tap)
```

**Delivery status is honest by design.** `sent` means only "the push service accepted it". It becomes `displayed` only when the Service Worker on your device confirms it showed the notification. The UI will show exactly these states, and nothing will claim delivery that has not been confirmed.

**Time zones:** every reminder stores your local time and IANA zone (e.g. `Asia/Karachi`), so "every Monday 9:00" stays at 9:00 local time across DST changes. All date arithmetic is done in code (Luxon/rrule), never by the AI.

**Missed runs:** if a cron tick is skipped or the project was paused, the next run picks up anything overdue (`next_fire_at <= now()`), marks it late, and still sends it, unless it is older than a configurable cutoff (default 24 h), in which case it is recorded as `missed`.

**Local vs deployed:**

| | Local development | Deployed (personal use) |
|---|---|---|
| App | `npm run dev` on your computer | Vercel Hobby |
| Database + cron + function | Supabase CLI in Docker on your computer | Supabase cloud |
| Reminders fire when computer is off? | **No** (local stack stops with your computer) | **Yes** |
| AI | Ollama on your computer | Ollama on your computer, called from your browser (optional) |

**Extensibility:** delivery goes through a `Channel` interface (`webpush` first). Email, WhatsApp, or calendar would be added later as more channels, never as requirements.

## 5. Local AI setup

**Computer requirements (practical guidance, not an official spec):**

| Model | Download | RAM | Speed on a typical laptop CPU |
|---|---|---|---|
| `llama3.2:3b` (default) | ~2 GB | 8 GB total system RAM | a few seconds per message |
| `qwen2.5:7b` (better parsing) | ~4.7 GB | 16 GB | slower on CPU; fast with a GPU or Apple Silicon |

**Install:**
1. Install Ollama from ollama.com (Windows, macOS, Linux).
2. `ollama pull llama3.2:3b`
3. Allow the Memoinder site to call it: set `OLLAMA_ORIGINS=https://<your-app>.vercel.app,http://localhost:3000` ([Ollama FAQ](https://docs.ollama.com/faq) covers setting env vars per OS), then restart Ollama. It listens on `http://127.0.0.1:11434`.

**How the app connects:** Vercel's servers cannot reach your computer, so the **browser** calls Ollama on `localhost:11434` directly, using Ollama's structured-output mode (`format` = a JSON schema) ([docs](https://docs.ollama.com/capabilities/structured-outputs)). Chrome 142+ will show a one-time "local network access" permission prompt for this ([Chrome blog](https://developer.chrome.com/blog/local-network-access)). Calling `http://localhost` from an `https` page is something I need to verify per browser in Phase 3; Safari is the most likely to block it. If it is blocked, the fallback is to run the app locally (`npm run dev`) on that computer for AI chat, while reminders still fire from the cloud.

**Reliability guardrails (the model never has the last word):**
1. `AIProvider` interface: `parse(text, context) → Action`. Implementations: `OllamaProvider`, `RuleBasedProvider` (chrono-node, no AI). Swapping models or providers does not touch the reminder engine.
2. The model outputs only intent + raw phrases (e.g. `"when": "next friday at 5pm"`, `"repeat": "every week"`). Code turns those into exact dates with chrono-node/Luxon/rrule.
3. Zod validates every response. Invalid JSON, unknown intents, past dates, or ambiguous times ("at 5" with no am/pm) produce a **clarification question** instead of a guess.
4. Every create/update/delete is shown as a confirmation card before it is saved.
5. If Ollama is not running, the app says so and uses the rule-based parser.

## 6. Expected monthly cost: **$0**

Conditions required to keep it at $0:
1. No payment method is added to Supabase, Vercel, Cloudflare, or GitHub. I will never enter payment details.
2. Stay on Supabase **Free** and Vercel **Hobby**. Do not start the Vercel Pro trial or enable Supabase add-ons (compute upgrades, PITR, custom domains, IPv4).
3. Vercel Hobby is for **personal, non-commercial** use only. Selling or commercialising Memoinder would require a different host.
4. Usage stays inside quotas (expected well under 10% of each).
5. The Supabase project stays active (normal weekly use; the dispatcher only adds traffic when reminders are due).
6. Ollama runs on hardware you already own (electricity is your only cost).

Before the first deployment I will produce a checklist of each service's actual dashboard settings (plan, billing page showing no card, usage) instead of claiming $0 from this document.

## 7. Compromises to stay at $0

1. **~1-minute precision.** Reminders fire within about a minute of their time, plus any push-service delay.
2. **Web Push is best-effort.** If your device is off or offline beyond the message TTL, the notification can be dropped. The status will show `sent` but not `displayed`.
3. **iPhone/iPad** need the app added to the Home Screen to receive notifications.
4. **AI only where Ollama runs.** On a phone, chat uses the rule-based parser (good for common phrases like "tomorrow 9am", "every Monday at 8").
5. **Supabase pausing risk** after 7 days of low activity. Reminders stop until you click Resume; no data is lost.
6. **No magic-link login** because the built-in email sender allows 2 emails/hour. Email + password instead.
7. **Rejected as schedulers:** Vercel Hobby cron (daily only), GitHub Actions schedule (5-minute minimum, delayed or dropped jobs), browser timers (need an open tab).
8. **Deferred:** WhatsApp, email delivery, calendar sync, document AI, paid monitoring.

## Phase plan (each phase ends with passing tests and a short "how to run" note)

| Phase | Delivers | Tests |
|---|---|---|
| 0 | Repo scaffold: Next.js + TS + Tailwind, Vitest, Playwright, ESLint, GitHub Actions CI, README | CI green |
| 1 | Reminder engine (pure TS): time zones, DST, RRULE next-occurrence, missed-run rules | Vitest unit tests incl. DST edge cases |
| 2 | Supabase schema + RLS + auth; create/list/edit/delete reminders in the UI | DB tests against local Supabase, Playwright CRUD |
| 3 | Chat: `AIProvider` interface, rule-based parser, Ollama provider, Zod validation, clarification flow | Unit tests with recorded model outputs; manual Ollama check |
| 4 | Web Push: Service Worker, subscriptions, `dispatch-reminders`, pg_cron, delivery status + ack | Local end-to-end: reminder fires with tab closed and is marked `displayed` |
| 5 | Deploy: Supabase cloud + Vercel Hobby, cost-safety checklist verified against real settings | Production smoke test of one real reminder |

Phase 1 needs no accounts at all. Supabase and Vercel sign-ups are first needed in Phase 2 and Phase 5, and you create them yourself.
