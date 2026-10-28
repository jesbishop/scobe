-- Run once in the Supabase SQL editor. Only the backend service role can reserve usage.
create table if not exists public.scobe_ai_usage (
  period timestamptz not null,
  bucket text not null,
  subject text not null,
  units bigint not null default 0 check (units >= 0),
  primary key (period, bucket, subject)
);
alter table public.scobe_ai_usage enable row level security;
revoke all on public.scobe_ai_usage from anon, authenticated;

create or replace function public.consume_ai_budget(p_user uuid, p_bucket text, p_units bigint, p_user_limit bigint, p_global_limit bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  window_start timestamptz;
  global_used bigint;
  user_used bigint;
begin
  if p_bucket not in ('chat', 'speech', 'requests') or p_units < 1 or p_user_limit < 1 or p_global_limit < 1 then raise exception 'invalid_budget'; end if;
  window_start := case when p_bucket = 'requests' then date_trunc('minute', now() at time zone 'UTC') at time zone 'UTC' else date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' end;
  -- One global lock per bucket/window serializes all reservations across backend replicas.
  perform pg_advisory_xact_lock(hashtextextended(p_bucket || extract(epoch from window_start)::text, 0));
  select units into global_used from public.scobe_ai_usage where period = window_start and bucket = p_bucket and subject = '*';
  select units into user_used from public.scobe_ai_usage where period = window_start and bucket = p_bucket and subject = p_user::text;
  if coalesce(global_used, 0) + p_units > p_global_limit or coalesce(user_used, 0) + p_units > p_user_limit then raise exception 'ai_usage_limit'; end if;
  insert into public.scobe_ai_usage(period,bucket,subject,units) values(window_start,p_bucket,'*',p_units)
    on conflict(period,bucket,subject) do update set units = public.scobe_ai_usage.units + excluded.units;
  insert into public.scobe_ai_usage(period,bucket,subject,units) values(window_start,p_bucket,p_user::text,p_units)
    on conflict(period,bucket,subject) do update set units = public.scobe_ai_usage.units + excluded.units;
end;
$$;
revoke all on function public.consume_ai_budget(uuid,text,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.consume_ai_budget(uuid,text,bigint,bigint,bigint) to service_role;
-- Optional scheduled retention: delete from public.scobe_ai_usage where period < now() - interval '32 days';
