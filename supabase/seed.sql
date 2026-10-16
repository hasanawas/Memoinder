-- LOCAL DEVELOPMENT ONLY. Runs on `npx supabase db reset`, never on a hosted project.
-- Points the every-minute pg_cron job at the locally served Edge Function.
-- (`kong` is the local API gateway's name inside Supabase's Docker network.)
select vault.create_secret('http://kong:8000/functions/v1/dispatch-reminders', 'memoinder_dispatch_url');
select vault.create_secret('local-dev-only-secret', 'memoinder_dispatch_secret');
