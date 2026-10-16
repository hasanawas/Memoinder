-- Reminders: one row per reminder, owned by one user.
--
-- The schedule is stored the way the user thinks about it (wall-clock time +
-- IANA zone + repeat rule). next_fire_at is a derived UTC instant computed by
-- the app's reminder engine (src/lib/engine) and is what the dispatcher scans.

create table public.reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  notes        text check (notes is null or char_length(notes) <= 2000),

  -- Wall-clock start, e.g. 2026-10-20 09:00 (no zone on purpose).
  start_local  timestamp without time zone not null,
  -- IANA zone name, e.g. Asia/Karachi. Validated by the app (Luxon) and here.
  time_zone    text not null,
  -- Repeat rule in the engine's JSON shape, or null for a one-off reminder.
  recurrence   jsonb,
  -- The same rule as RFC 5545 text, for humans and future calendar export.
  rrule        text,

  -- Next moment to notify, in UTC. Null once a reminder has no occurrences left.
  next_fire_at timestamptz,
  status       text not null default 'active' check (status in ('active', 'completed')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint recurrence_is_object check (recurrence is null or jsonb_typeof(recurrence) = 'object'),
  constraint active_has_next check (status <> 'active' or next_fire_at is not null)
);

comment on table public.reminders is 'User reminders. Schedules are wall-clock time + IANA zone; next_fire_at is derived.';

-- Reject unknown zones even if a client bypasses the app's validation.
create function public.is_valid_time_zone(tz text) returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

create function public.reminders_before_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_valid_time_zone(new.time_zone) then
    raise exception 'Unknown time zone: %', new.time_zone using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger reminders_before_write
  before insert or update on public.reminders
  for each row execute function public.reminders_before_write();

-- The upcoming list and, later, the dispatcher both read by next_fire_at.
create index reminders_user_next_idx on public.reminders (user_id, next_fire_at);
create index reminders_due_idx on public.reminders (next_fire_at) where status = 'active';

-- Row Level Security: each signed-in user can see and change only their rows.
alter table public.reminders enable row level security;

create policy "Users read their own reminders"
  on public.reminders for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users create their own reminders"
  on public.reminders for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update their own reminders"
  on public.reminders for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete their own reminders"
  on public.reminders for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Anonymous visitors get nothing.
revoke all on public.reminders from anon;
