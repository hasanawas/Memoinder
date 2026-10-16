# Notifications (Phase 4)

Reminders are sent by the server, not by an open tab. Once you turn notifications on for a device, a reminder reaches it even when no Memoinder tab is open.

## How a reminder gets to you

```
every minute     pg_cron job "memoinder-dispatch" (inside Postgres)
                   └─ private.invoke_dispatcher(): is anything due? if not, stop here
                        └─ pg_net POST, with a shared secret from Vault
Edge Function    dispatch-reminders (Deno)
                   1. claim due reminders (FOR UPDATE SKIP LOCKED + 5 min lease)
                   2. for each of your devices: encrypt (RFC 8291), sign (VAPID, RFC 8292), POST
                   3. write a deliveries row per device, move repeats to their next time
push service     Google (Chrome/Edge/Android), Mozilla (Firefox), Apple (Safari)
your device      public/sw.js shows the notification, then POSTs /api/deliveries/ack
                   └─ public.ack_delivery() checks the one-time token: status becomes "displayed"
```

Code: [`src/lib/push/webpush.ts`](../src/lib/push/webpush.ts) (encryption and VAPID, Web Crypto only, no dependencies), [`src/lib/dispatch/dispatch.ts`](../src/lib/dispatch/dispatch.ts) (what to send and what to record), [`supabase/functions/dispatch-reminders`](../supabase/functions/dispatch-reminders/index.ts) (the thin Deno entry point), [`supabase/migrations/20261016100000_push.sql`](../supabase/migrations/20261016100000_push.sql) (tables, access rules, cron jobs).

## What each status means

| Status | Meaning |
|---|---|
| Shown on your device | The device's Service Worker confirmed it displayed the notification |
| Shown and opened | You tapped it |
| Sent, not yet confirmed by a device | The push service accepted it. This is **not** proof you saw it: the device may be off, or offline, or the confirmation could not get back |
| Sending failed | The push service refused it or could not be reached (the error is shown in History) |
| Device no longer subscribed | The push service said the subscription is gone (HTTP 404/410); that device is removed |
| Not sent: notifications are off on all your devices | It came due but no device had notifications on |
| Missed | More than 24 hours late (for example after the project was paused), so it was not sent |
| (late) | Sent more than 2 minutes after its time |

After downtime, a repeating reminder sends only its most recent occurrence and records the older ones as missed, instead of sending a burst.

## Does my computer need to stay on?

- **Deployed (Phase 5): no.** The schedule, the function and the database all run in Supabase's cloud. Your device only needs to be able to receive.
- **Local development: yes.** Locally, Supabase runs in Docker on your computer, so reminders only go out while it and `npx supabase functions serve` are running.

What the receiving device needs ([web.dev push FAQ](https://web.dev/articles/push-notifications-faq)):

- **Android:** nothing; the system wakes the browser when a message arrives.
- **Desktop Chrome/Edge/Firefox:** the browser must be running, but no window needs to be open. If it is fully quit, the push service holds the message for up to 24 hours (the TTL we set) and it appears when the browser starts.
- **iPhone/iPad (iOS 16.4+):** add Memoinder to the Home Screen first and turn notifications on from there ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).

## Run it locally

One-time setup:

```bash
npm run push:keys                        # prints a fresh VAPID key pair
cp supabase/functions/.env.example supabase/functions/.env
# paste VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY into supabase/functions/.env,
# set VAPID_SUBJECT to mailto:<your email>,
# and put NEXT_PUBLIC_VAPID_PUBLIC_KEY in .env.local
npx supabase db reset                    # applies migrations and supabase/seed.sql (local Vault settings)
```

Each session, in three terminals:

```bash
npx supabase start
npx supabase functions serve             # serves dispatch-reminders on :54321
npm run dev
```

Then open http://localhost:3000/reminders **in Chrome, Edge or Firefox (not a private window)**, click **Turn on notifications**, allow them, click **Send a test**, and close the tab. The test reminder should appear within about a minute, and **History** should say "Shown on your device". `localhost` counts as a secure origin, so no HTTPS is needed locally.

Locally, the Edge Function really does talk to Google's/Mozilla's/Apple's push service from your computer. That is free and needs no account.

## What has been tested, and what has not

Tested automatically (run on every pull request):

- Encryption reproduces the worked example in RFC 8291 Appendix A byte for byte; VAPID tokens verify; push-service responses map to the right status ([`webpush.test.ts`](../src/lib/push/webpush.test.ts)).
- Dispatcher rules: devices, repeats, late/missed, downtime, expired devices, a broken row not blocking others, your edit winning over an in-flight send ([`dispatch.test.ts`](../src/lib/dispatch/dispatch.test.ts)).
- Against the real local database: access rules for devices and deliveries, sending to two devices, acknowledgement with right and wrong tokens, no double send when three runs overlap ([`tests/db/push.test.ts`](../tests/db/push.test.ts)).
- **The real schedule with nothing faked:** pg_cron fires on its own, calls the real Edge Function in the Deno runtime, which encrypts, signs, attempts delivery and records the outcome ([`tests/db/cron.test.ts`](../tests/db/cron.test.ts)).
- **In a real Chromium with the Memoinder tab closed:** the Service Worker receives the encrypted message, shows the notification, and the history page then says "Shown on your device" ([`tests/e2e/push.spec.ts`](../tests/e2e/push.spec.ts)).

Not yet tested:

- **The hop through a real push service to a real device.** The build sandbox cannot reach Google's push servers from its browser, so the test hands the message to the Service Worker through Chrome DevTools, the same way Chrome does when its push service delivers. The manual check above covers that hop; Phase 5 repeats it on the deployed app.
- Tapping a notification (headless browsers cannot click notifications). The click handler is short and is checked in the manual test.
- Safari and iOS.

## Free-tier usage and how it stays at $0

| Resource | Use | Free limit |
|---|---|---|
| Edge Function invocations | At most 1 per minute, and **only in minutes when something is due** (the database checks first). Worst case 44,640/month | 500,000/month |
| Edge Function CPU | A few milliseconds of crypto per message | 2 s per request |
| pg_net | ≤ 1 request per minute; responses auto-deleted after 6 hours | designed for 200/s |
| Database size | One small row per delivery. A daily job deletes cron logs older than 3 days and deliveries older than 90 days | 500 MB |
| Push services | Standard Web Push; no account, no fee | none published |

The Free plan cannot be charged for going over; it is limited instead. Because the database now only calls the function when something is due, quiet days produce no API traffic from the scheduler. Whether pg_cron activity counts against Supabase's 7-day inactivity pause is not documented, so the pause risk in [architecture.md](architecture.md) still applies.

## Security notes

- The VAPID **private** key lives only in the Edge Function's secrets (`supabase/functions/.env` locally, `npx supabase secrets set` when hosted). The browser only gets the public key.
- The function refuses calls without the `x-memoinder-secret` header, which pg_cron reads from Vault. JWT verification is off for this one function because pg_cron is not a signed-in user.
- Devices can only be added through `save_push_subscription()`, which requires sign-in and an `https://` endpoint, so the dispatcher cannot be pointed at internal addresses.
- Each push carries a random one-time token; only its SHA-256 is stored, and users cannot read it. That token is the only way to mark a delivery as shown.
- Delivery is at-least-once: if the function crashes after sending but before recording, the reminder is retried after its 5-minute lease and could arrive twice. It is never silently dropped by that path.
