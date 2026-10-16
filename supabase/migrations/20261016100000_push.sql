-- Phase 4: Web Push delivery that works with the browser closed.
--
-- Flow: pg_cron (every minute) -> private.invoke_dispatcher() -> pg_net POST
-- -> Edge Function dispatch-reminders -> Web Push -> Service Worker on the
-- device -> public.ack_delivery() marks the delivery as displayed/clicked.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Push subscriptions: one row per browser/device that said yes to notifications.

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Push service URL handed out by the browser. Unique: one device, one row.
  endpoint      text not null unique check (char_length(endpoint) <= 2000),
  p256dh        text not null check (char_length(p256dh) between 80 and 100),
  auth          text not null check (char_length(auth) between 16 and 30),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 500),
  created_at    timestamptz not null default now(),
  last_sent_at  timestamptz,
  failure_count integer not null default 0
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "Users read their own devices"
  on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users remove their own devices"
  on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Inserts go through save_push_subscription() so that a browser that was
-- used by another account is handed over cleanly instead of failing.
revoke all on public.push_subscriptions from anon;
revoke insert, update on public.push_subscriptions from authenticated;

create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sub_id uuid;
begin
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  -- Real push services are always https. This also stops the dispatcher
  -- being pointed at arbitrary internal addresses.
  if p_endpoint !~ '^https://' then
    raise exception 'Push endpoint must be https' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, failure_count = 0
  returning id into sub_id;
  return sub_id;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- Used by the dispatcher to count consecutive failures per device.
create function public.note_push_failure(p_id uuid) returns void
language sql
set search_path = ''
as $$
  update public.push_subscriptions set failure_count = failure_count + 1 where id = p_id;
$$;

revoke all on function public.note_push_failure(uuid) from public, anon, authenticated;
grant execute on function public.note_push_failure(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Deliveries: what actually happened for each reminder occurrence.
--
--   no_device  the reminder came due but you had no device subscribed
--   sent       the push service accepted it (not proof it was shown)
--   failed     the push service refused it or could not be reached
--   expired    the device's subscription no longer exists (it is removed)
--   missed     more than 24 h late (e.g. the project was paused), not sent
--   displayed  the device's Service Worker reported it showed the notification
--   clicked    you tapped the notification

create table public.deliveries (
  id              uuid primary key default gen_random_uuid(),
  reminder_id     uuid not null references public.reminders (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.push_subscriptions (id) on delete set null,
  title           text not null,
  scheduled_for   timestamptz not null,
  lateness        text check (lateness in ('on_time', 'late', 'missed')),
  status          text not null check (status in ('no_device', 'sent', 'failed', 'expired', 'missed', 'displayed', 'clicked')),
  http_status     integer,
  error           text check (error is null or char_length(error) <= 500),
  -- SHA-256 of the one-time token inside the push message. Only the device
  -- that received the message can acknowledge it.
  ack_token_hash  bytea,
  created_at      timestamptz not null default now(),
  displayed_at    timestamptz,
  clicked_at      timestamptz
);

create index deliveries_user_created_idx on public.deliveries (user_id, created_at desc);
create index deliveries_reminder_idx on public.deliveries (reminder_id, created_at desc);
create index deliveries_created_idx on public.deliveries (created_at);

alter table public.deliveries enable row level security;

create policy "Users read their own deliveries"
  on public.deliveries for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.deliveries from anon;
revoke insert, update, delete on public.deliveries from authenticated;
-- Never hand the token hash to the browser.
revoke select on public.deliveries from authenticated;
grant select (id, reminder_id, subscription_id, title, scheduled_for, lateness, status, http_status, error,
              created_at, displayed_at, clicked_at)
  on public.deliveries to authenticated;

-- Called by the Service Worker. Needs no sign-in: the one-time token is the proof.
create function public.ack_delivery(p_id uuid, p_token text, p_event text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  hit int;
begin
  if p_event not in ('displayed', 'clicked') or p_token is null or char_length(p_token) > 100 then
    return false;
  end if;
  update public.deliveries d
     set status = case when p_event = 'clicked' then 'clicked'
                       when d.status = 'clicked' then 'clicked'
                       else 'displayed' end,
         displayed_at = coalesce(d.displayed_at, now()),
         clicked_at = case when p_event = 'clicked' then coalesce(d.clicked_at, now()) else d.clicked_at end
   where d.id = p_id
     and d.status in ('sent', 'displayed', 'clicked')
     and d.ack_token_hash = pg_catalog.sha256(convert_to(p_token, 'UTF8'));
  get diagnostics hit = row_count;
  return hit = 1;
end;
$$;

revoke all on function public.ack_delivery(uuid, text, text) from public;
grant execute on function public.ack_delivery(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Claiming due reminders. Several dispatcher runs may overlap (a slow run and
-- the next minute's run); SKIP LOCKED plus a lease makes sure each reminder
-- occurrence is handled by exactly one of them.

alter table public.reminders
  add column claim_id uuid,
  add column claimed_until timestamptz;

create function public.claim_due_reminders(p_limit integer default 50, p_lease interval default '5 minutes')
returns table (
  id uuid, user_id uuid, title text, notes text, start_local timestamp, time_zone text,
  recurrence jsonb, next_fire_at timestamptz, claim_id uuid
)
language sql
set search_path = ''
as $$
  with due as (
    select r.id
      from public.reminders r
     where r.status = 'active'
       and r.next_fire_at <= now()
       and (r.claimed_until is null or r.claimed_until < now())
     order by r.next_fire_at
     limit p_limit
       for update skip locked
  )
  update public.reminders r
     set claim_id = gen_random_uuid(), claimed_until = now() + p_lease
    from due
   where r.id = due.id
  returning r.id, r.user_id, r.title, r.notes, r.start_local, r.time_zone, r.recurrence, r.next_fire_at, r.claim_id;
$$;

revoke all on function public.claim_due_reminders(integer, interval) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer, interval) to service_role;

-- If you edit a reminder while the dispatcher holds it, your edit wins: the
-- claim is dropped, so the dispatcher's own update (which checks claim_id)
-- does not overwrite your new time.
create or replace function public.reminders_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_time_zone(new.time_zone) then
    raise exception 'Unknown time zone: %', new.time_zone using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.claim_id := null;
    new.claimed_until := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Users cannot set claim columns themselves.
revoke update on public.reminders from authenticated;
grant update (title, notes, start_local, time_zone, recurrence, rrule, next_fire_at, status)
  on public.reminders to authenticated;

-- ---------------------------------------------------------------------------
-- The schedule. Configuration lives in Vault (see docs/notifications.md):
--   memoinder_dispatch_url     e.g. https://<project-ref>.supabase.co/functions/v1/dispatch-reminders
--   memoinder_dispatch_secret  random string, same value as the function's MEMOINDER_DISPATCH_SECRET
-- Until both exist the job does nothing.

create function private.invoke_dispatcher() returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text;
  fn_secret text;
begin
  -- Only call the Edge Function when something is actually due, so idle
  -- minutes cost no function invocations at all.
  if not exists (
    select 1 from public.reminders r
     where r.status = 'active' and r.next_fire_at <= now()
       and (r.claimed_until is null or r.claimed_until < now())
  ) then
    return null;
  end if;

  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'memoinder_dispatch_url';
  select decrypted_secret into fn_secret from vault.decrypted_secrets where name = 'memoinder_dispatch_secret';
  if fn_url is null or fn_secret is null then
    raise warning 'memoinder: dispatcher not configured (Vault secrets missing)';
    return null;
  end if;

  return net.http_post(
    url := fn_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-memoinder-secret', fn_secret),
    body := jsonb_build_object('at', now()),
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function private.invoke_dispatcher() from public;

select cron.schedule('memoinder-dispatch', '* * * * *', 'select private.invoke_dispatcher()');

-- Keep the free 500 MB database small: drop old job logs and delivery history.
select cron.schedule(
  'memoinder-cleanup',
  '17 3 * * *',
  $$
    delete from cron.job_run_details where end_time < now() - interval '3 days';
    delete from public.deliveries where created_at < now() - interval '90 days';
  $$
);
