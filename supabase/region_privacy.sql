-- Run last, after location_privacy.sql. No private record is deleted or rewritten.
begin;
set local lock_timeout='5s';
lock table public.listings in share row exclusive mode;
create temp table region_records_before on commit drop as select id,to_jsonb(l)-'region' payload from public.listings l;
alter table public.listings add column if not exists region text check(region in ('北部','中部','南部','生态园','大朗','寮步','大岭山'));
create or replace function private.infer_listing_region(t text)
returns text language sql immutable security invoker set search_path='' as $$
 select case when count(*)=1 then min(region) end from
 (values ('北部','北部'),('中部','中部'),('南部','南部'),('生态园','生态园'),('大朗','大朗'),('寮步','寮步'),('大岭山','大岭山')) r(region,term)
 where coalesce(t,'') like '%'||term||'%';
$$;
revoke all on function private.infer_listing_region(text) from public,anon,authenticated;
update public.listings set region=private.infer_listing_region(concat_ws(' ',title,park,address,description)) where region is null;
with known as (select park,min(region) region from public.listings where region is not null group by park having count(distinct region)=1)
update public.listings l set region=k.region from known k where l.region is null and l.park=k.park;

create or replace function private.redact_listing_text(t text,p text,r text,a text)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare secret text; remaining text; result text:=t; output text; at_pos integer;
begin
 if t is null then return null; end if;
 foreach secret in array array[p,a] loop
  if secret is null or length(trim(secret))<2 or secret in ('北部','中部','南部','生态园','大朗','寮步','大岭山','松山湖北部','松山湖中部','松山湖南部','松山湖生态园','松山湖','近松山湖') then continue; end if;
  remaining:=result; output:='';
  loop
   at_pos:=strpos(lower(remaining),lower(secret));
   exit when at_pos=0;
   output:=output||left(remaining,at_pos-1)||'[位置资料已隐藏]';
   remaining:=substr(remaining,at_pos+length(secret));
  end loop;
  result:=output||remaining;
 end loop;
 -- Room numbers are matched as standalone tokens, never inside decimals/phones.
 if length(coalesce(r,''))>0 and r ~ '^[[:alnum:]-]+$' then
  result:=regexp_replace(result,'(?<![[:alnum:].])'||r||'(?![[:alnum:].])','[房号已隐藏]','gi');
 end if;
 return result;
end $$;
revoke all on function private.redact_listing_text(text,text,text,text) from public;
grant usage on schema private to anon,authenticated;
grant execute on function private.redact_listing_text(text,text,text,text) to anon,authenticated;

-- Preserve the existing public whitelist; redact names in public text on the server.
do $$
declare definition text:=pg_get_viewdef('public.public_listings'::regclass,true); projection text;
begin
 select string_agg(case
  when attname in ('park','unit','building','room','address') then format('null::text as %I',attname)
  when attname in ('latitude','longitude') then format('null::numeric as %I',attname)
  when attname='region' then 'l.region'
  when atttypid='text'::regtype and attname not in ('contact_name','contact_phone','wechat','video_channel','status')
   then format('private.redact_listing_text(p.%I,l.park,l.room,l.address) as %I',attname,attname)
  else format('p.%I',attname) end,',' order by attnum) into projection
 from pg_attribute where attrelid='public.public_listings'::regclass and attnum>0 and not attisdropped;
 if not exists(select 1 from pg_attribute where attrelid='public.public_listings'::regclass and attname='region' and not attisdropped) then projection:=projection||',l.region'; end if;
  execute 'create or replace view public.public_listings with (security_barrier=true) as select '||projection||' from ('||regexp_replace(definition,';[[:space:]]*$','')||') p join public.listings l on l.id=p.id';
end $$;
revoke all on public.parks from anon;
revoke select(id,name,active) on public.parks from anon;
drop policy if exists "public active parks" on public.parks;
do $$ begin
 if exists(select 1 from public.listings l full join region_records_before b using(id) where (to_jsonb(l)-'region') is distinct from b.payload) then raise exception 'Unrelated private data changed'; end if;
 if exists(select 1 from public.public_listings where park is not null or room is not null or unit is not null or address is not null or latitude is not null or longitude is not null) then raise exception 'Location privacy failed'; end if;
end $$;
notify pgrst,'reload schema';
commit;
