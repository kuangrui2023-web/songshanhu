-- Add only a public code alias to the existing privacy-filtered projection.
begin;
set local lock_timeout='5s';
create temp table codes_private_before on commit drop as select id,to_jsonb(l) payload from public.listings l;
create temp table codes_public_before on commit drop as select id,to_jsonb(p)-'listing_code' payload from public.public_listings p;
do $$
declare definition text:=pg_get_viewdef('public.public_listings'::regclass,true);
begin
 if not exists(select 1 from pg_attribute where attrelid='public.public_listings'::regclass and attname='listing_code' and not attisdropped) then
  execute 'create or replace view public.public_listings with (security_barrier=true) as select p.*,case when l.internal_code ~ ''^[0-9]{6}$'' then l.internal_code else null end as listing_code from ('||regexp_replace(definition,';[[:space:]]*$','')||') p join public.listings l on l.id=p.id';
 end if;
 if exists(select 1 from public.listings l full join codes_private_before b using(id) where to_jsonb(l) is distinct from b.payload) then raise exception 'Private records changed'; end if;
 if exists(select 1 from public.public_listings p full join codes_public_before b using(id) where (to_jsonb(p)-'listing_code') is distinct from b.payload) then raise exception 'Existing public projection changed'; end if;
 if exists(select 1 from public.public_listings where park is not null or unit is not null or building is not null or room is not null or address is not null or latitude is not null or longitude is not null) then raise exception 'Position privacy failed'; end if;
 if exists(select 1 from pg_attribute where attrelid='public.public_listings'::regclass and attnum>0 and not attisdropped and attname in ('internal_code','owner_contact_name','owner_contact_phone','owner_floor_price','channel_notes','followup_notes')) then raise exception 'Private column exposed'; end if;
 if has_table_privilege('anon','public.listings','SELECT') then raise exception 'Anonymous base table access'; end if;
end $$;
comment on column public.public_listings.listing_code is '公开六位房源编号，沿用原编号，供客户报号与搜索。';
notify pgrst,'reload schema';
commit;
