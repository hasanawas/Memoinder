# Deploying Memoinder for $0

Memoinder runs on three free services. Nothing here needs a card, and none should ever have one added.

| Service | What it runs | Plan | Limits that matter (checked 2026-10-16) |
|---|---|---|---|
| **GitHub Pages** | The website (static HTML/JS) at `https://hasanawas.github.io/Memoinder/` | Free, public repo | 1 GB site, 100 GB/month soft bandwidth, personal and non-commercial use only, should not handle passwords or card numbers ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) |
| **GitHub Actions** | Tests on every PR; building and publishing the site; the one-click Supabase setup | Free for public repos | Standard runners |
| **Supabase** | Database, sign-in, the every-minute schedule, the sending function | **Free** | 500 MB database, 500k function calls/month, pauses after 7 days of low activity, built-in email: 2 per hour and **only to members of your Supabase team** ([email limits](https://supabase.com/docs/guides/auth/auth-smtp)) |

Browser push services (Google, Mozilla, Apple) need no account.

## Why GitHub Pages changed the app

Pages only serves files, with no server code. So the browser talks to Supabase directly, and **Row Level Security in the database is what keeps your data private**. It already was; the server code only added convenience checks. Sign-in uses an emailed link instead of a password, because GitHub asks that Pages sites not handle passwords. Supabase's built-in email sends at most 2 messages per hour and only to your own team's addresses. That is enough for one person, because a sign-in lasts until you sign out.

## One-time setup

Nothing needs installing on your computer: the database and the sending function are set up by a GitHub Actions workflow you start with one click (step 3). GitHub's machines already have Docker, which bundling the sending function needs.

### 1. Turn on GitHub Pages

GitHub: repository **Settings > Pages > Build and deployment > Source: GitHub Actions**. After that, every merge to `main` publishes the site (`.github/workflows/pages.yml`).

### 2. Supabase dashboard settings

- **Authentication > URL Configuration**
  - Site URL: `https://hasanawas.github.io/Memoinder/`
  - Redirect URLs: add `https://hasanawas.github.io/Memoinder/**`
- **Authentication > Emails > Templates**: leave them as they are. Supabase only lets you edit them after adding custom SMTP, so the email has just a sign-in link. Open that link in the same browser where you asked for it. ([`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html) adds a 6-digit code, for if you ever set up a free SMTP sender.)
- Do **not** add a custom SMTP server, a custom domain or any add-on.

### 3. Database, schedule and sending function

1. **Get a Supabase access token**: [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) > **Generate new token**, name it `memoinder-setup`, copy it.
2. **Add two repository secrets**: GitHub repository **Settings > Secrets and variables > Actions > New repository secret**:
   - `SUPABASE_ACCESS_TOKEN`: the token from step 1.
   - `SUPABASE_DB_PASSWORD`: the database password you chose when creating the project (forgot it? **Project Settings > Database > Reset database password**).
3. **Run it**: **Actions** tab > **Set up Supabase** > **Run workflow**. It takes a few minutes and:
   - creates the tables, access rules and every-minute schedule (`supabase db push`);
   - creates the push keys and a random dispatch secret, stores them as function secrets and in Vault, without printing the private ones;
   - deploys the sending function.

   When it finishes, open the run: its summary shows the **public push key**.

It is safe to run again later (for example after a new migration): it keeps the existing keys. The access token can do anything in your Supabase account, so you can delete it on the tokens page once setup is done and make a new one if you ever need to run the workflow again.

<details><summary>Doing it from your own computer instead (needs Docker)</summary>

```bash
npx supabase login
npx supabase link --project-ref qsswfleiurvwlumudwia
npx supabase db push
npm run push:keys
npx supabase secrets set MEMOINDER_DISPATCH_SECRET=<random> VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> VAPID_SUBJECT=https://github.com/hasanawas/Memoinder
npx supabase functions deploy dispatch-reminders
```

Then in **SQL Editor**: `select vault.create_secret('https://qsswfleiurvwlumudwia.supabase.co/functions/v1/dispatch-reminders', 'memoinder_dispatch_url');` and `select vault.create_secret('<random>', 'memoinder_dispatch_secret');`.
</details>

### 4. Give the site the public key

Send me the **public** push key from the workflow summary (it is meant to be public). I add it to `.github/workflows/pages.yml`, and the next deploy turns on the notifications panel.

### 5. Create your account, then close sign-ups

Open `https://hasanawas.github.io/Memoinder/`, choose **Open my reminders**, and sign in with the email you use for Supabase (the built-in sender only delivers to it). Then go to **Authentication > Sign In / Providers** and turn off **Allow new users to sign up**, so nobody else can create an account.

### 6. Smoke test

On your phone (Android: Chrome; iPhone: add to Home Screen first, then open it from there), sign in, choose **Turn on notifications**, then **Send a test**, and close the app. It should arrive within about a minute, and **History** should say "Shown on your device".

On iPhone the sign-in link opens in Safari, not in the Home Screen app, so the app stays signed out. If that happens, tell me: the free fix is a custom SMTP sender (for example a Gmail app password), which lets the email show a code you can type into the app.

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
