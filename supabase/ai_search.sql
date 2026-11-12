-- AI cost guard. No prompts, API keys, or raw IP addresses are stored here.
begin;
create table if not exists public.ai_search_limits (
  bucket text primary key,
  hits integer not null default 0,
  touched_at timestamptz not null default now()
);
alter table public.ai_search_limits enable row level security;
revoke all on public.ai_search_limits from public,anon,authenticated;
grant all on public.ai_search_limits to service_role;

create or replace function public.reserve_ai_search(p_client text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  day_key text := 'day:' || to_char(now() at time zone 'Asia/Shanghai','YYYY-MM-DD');
  client_key text := 'client:' || p_client || ':' || to_char(now() at time zone 'UTC','YYYY-MM-DD-HH24');
  day_hits integer;
  client_hits integer;
begin
  if p_client !~ '^[a-f0-9]{64}$' then raise exception 'Invalid client hash'; end if;
  -- Serialize reservations, including the global cap, across Edge instances.
  perform pg_advisory_xact_lock(724102020);
  select hits into day_hits from public.ai_search_limits where bucket=day_key;
  select hits into client_hits from public.ai_search_limits where bucket=client_key;
  if coalesce(day_hits,0)>=200 then return jsonb_build_object('allowed',false,'scope','day'); end if;
  if coalesce(client_hits,0)>=15 then return jsonb_build_object('allowed',false,'scope','client'); end if;
  insert into public.ai_search_limits(bucket,hits) values(day_key,1),(client_key,1)
    on conflict(bucket) do update set hits=ai_search_limits.hits+1,touched_at=now();
  delete from public.ai_search_limits where touched_at<now()-interval '3 days';
  return jsonb_build_object('allowed',true);
end;
$$;
revoke all on function public.reserve_ai_search(text) from public,anon,authenticated;
grant execute on function public.reserve_ai_search(text) to service_role;
commit;
