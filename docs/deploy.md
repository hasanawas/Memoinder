# Deploying Memoinder for $0

Memoinder runs on three free services. Nothing here needs a card, and none should ever have one added.

| Service | What it runs | Plan | Limits that matter (checked 2026-10-16) |
|---|---|---|---|
| **GitHub Pages** | The website (static HTML/JS) at `https://hasanawas.github.io/Memoinder/` | Free, public repo | 1 GB site, 100 GB/month soft bandwidth, personal and non-commercial use only, should not handle passwords or card numbers ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) |
| **GitHub Actions** | Tests on every PR; building and publishing the site | Free for public repos | Standard runners |
| **Supabase** | Database, sign-in, the every-minute schedule, the sending function | **Free** | 500 MB database, 500k function calls/month, pauses after 7 days of low activity, built-in email: 2 per hour and **only to members of your Supabase team** ([email limits](https://supabase.com/docs/guides/auth/auth-smtp)) |

Browser push services (Google, Mozilla, Apple) need no account.

## Why GitHub Pages changed the app

Pages only serves files, with no server code. So the browser talks to Supabase directly, and **Row Level Security in the database is what keeps your data private**. It already was; the server code only added convenience checks. Sign-in uses an emailed 6-digit code instead of a password, because GitHub asks that Pages sites not handle passwords. Supabase's built-in email sends at most 2 messages per hour and only to your own team's addresses. That is enough for one person, because a sign-in lasts until you sign out.

## One-time setup

Run the terminal steps on your own computer, in a clone of the repository, after `npm install`. Steps 3 to 5 need Docker running (the same as local development): the sending function bundles to about 12 MB, which is over the 5 MB limit for bundling without Docker.

### 1. Turn on GitHub Pages

GitHub: repository **Settings > Pages > Build and deployment > Source: GitHub Actions**. After that, every merge to `main` publishes the site (`.github/workflows/pages.yml`).

### 2. Supabase dashboard settings

- **Authentication > URL Configuration**
  - Site URL: `https://hasanawas.github.io/Memoinder/`
  - Redirect URLs: add `https://hasanawas.github.io/Memoinder/**`
- **Authentication > Emails > Templates**: for both **Magic Link** and **Confirm signup**, set the subject to `Your Memoinder sign-in code` and paste the body of [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html). It shows the 6-digit code, which the default template does not.
- Do **not** add a custom SMTP server, a custom domain or any add-on.

### 3. Database, schedule and sending function

```bash
npx supabase login                                      # opens your browser
npx supabase link --project-ref qsswfleiurvwlumudwia    # asks for the database password
npx supabase db push                                    # creates tables, access rules and the cron jobs

npm run push:keys                                       # prints a VAPID key pair
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # a random dispatch secret

npx supabase secrets set \
  MEMOINDER_DISPATCH_SECRET=<the random secret> \
  VAPID_PUBLIC_KEY=<public key> \
  VAPID_PRIVATE_KEY=<private key> \
  VAPID_SUBJECT=mailto:<your email>

npx supabase functions deploy dispatch-reminders        # verify_jwt=false comes from supabase/config.toml
```

Then in **SQL Editor**, run this once (same random secret as above):

```sql
select vault.create_secret('https://qsswfleiurvwlumudwia.supabase.co/functions/v1/dispatch-reminders', 'memoinder_dispatch_url');
select vault.create_secret('<the random secret>', 'memoinder_dispatch_secret');
```

Keep the private key and the random secret only in those two places. Never paste them into chat, an issue or a commit.

### 4. Give the site the public key

Send me the **public** VAPID key (it is meant to be public). I add it to `.github/workflows/pages.yml`, and the next deploy turns on the notifications panel.

### 5. Create your account, then close sign-ups

Open `https://hasanawas.github.io/Memoinder/`, choose **Open my reminders**, and sign in with the email you use for Supabase (the built-in sender only delivers to it). Then go to **Authentication > Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can create an account.

### 6. Smoke test

On your phone (Android: Chrome; iPhone: add to Home Screen first, then open it from there), sign in, choose **Turn on notifications**, then **Send a test**, and close the app. It should arrive within about a minute, and **History** should say "Shown on your device".

## Cost-safety checklist (I check this against your real dashboards before calling it $0)

- [ ] Supabase **Organization > Billing**: plan is Free, no payment method on file.
- [ ] Supabase **Usage**: database size, function invocations and egress well under the Free limits.
- [ ] Supabase **Add-ons**: none enabled (no compute upgrade, PITR, custom domain or IPv4).
- [ ] GitHub **Settings > Billing and plans**: Free plan, no payment method needed for Pages or Actions on a public repo.
- [ ] The repository is public (Pages on a private repo needs a paid plan).
- [ ] Nothing commercial: Pages is for personal, non-commercial sites.

What happens at a limit: Supabase Free restricts or pauses the project rather than charging. A paused project stops reminders until you click Resume, with no data lost. GitHub Pages' limits are soft: GitHub says that over them it may stop serving the site or send you an email; there is no charge on a free public repo.

## Local AI with the deployed site

Add `https://hasanawas.github.io` to `OLLAMA_ORIGINS` ([docs/local-ai.md](local-ai.md)). Whether Safari lets an https page call `http://127.0.0.1` has not been tested yet; Chrome asks for Local Network Access permission once.
