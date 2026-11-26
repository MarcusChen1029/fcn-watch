-- Waitlist for alert emails + daily visit counts. Anonymous visitors can only call the two
-- RPCs below; they can never read either table. No IPs or user agents are stored.

create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique check (length(email) <= 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notes_count int not null default 0 check (notes_count between 0 and 1000),
  created_at timestamptz not null default now()
);

create table public.daily_visits (
  day date not null default (now() at time zone 'Asia/Taipei')::date,
  path text not null check (length(path) <= 64),
  hits int not null default 0,
  primary key (day, path)
);

alter table public.waitlist enable row level security;
alter table public.daily_visits enable row level security;
revoke all on public.waitlist, public.daily_visits from anon, authenticated;

-- Returns 'ok', 'exists', 'invalid' or 'full'. Hard cap keeps abuse from filling the free plan.
create or replace function public.join_waitlist(p_email text, p_notes int default 0)
returns text language plpgsql security definer set search_path = public as $$
declare e text := lower(trim(coalesce(p_email, '')));
begin
  if length(e) > 254 or e !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid'; end if;
  if (select count(*) from waitlist) >= 20000 then return 'full'; end if;
  insert into waitlist (email, notes_count) values (e, least(greatest(coalesce(p_notes, 0), 0), 1000))
  on conflict (email) do nothing;
  return case when found then 'ok' else 'exists' end;
end $$;

-- One counter row per day per page; paths outside the short allow-list are folded into 'other'.
create or replace function public.hit(p_path text)
returns void language plpgsql security definer set search_path = public as $$
declare p text := case when p_path in ('/', '/add', '/example', '/alert-cta') then p_path else 'other' end;
begin
  insert into daily_visits (path, hits) values (p, 1)
  on conflict (day, path) do update set hits = daily_visits.hits + 1;
end $$;

revoke all on function public.join_waitlist(text, int), public.hit(text) from public;
grant execute on function public.join_waitlist(text, int), public.hit(text) to anon;
