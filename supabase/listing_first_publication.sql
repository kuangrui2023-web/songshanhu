-- First publication time drives the 24-hour new-listing badge.
-- Run after listing_editor_fields.sql and listing_internal_codes.sql.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.listings in access exclusive mode;
create temp table publication_before on commit drop as
  select id,to_jsonb(l)-'first_published_at' as existing_fields from public.listings l;
create temp table publication_public_before on commit drop as
  select id,to_jsonb(p)-'first_published_at' as existing_fields from public.public_listings p;
alter table public.listings add column if not exists first_published_at timestamptz;
-- Recover actual first publication, not the last edit/renumber timestamp.
-- Only old published rows without any audit event fall back to their original creation time.
with first_publish as (
  select listing_id,min(created_at) as published_at from public.audit_logs
  where new_record->>'status'='published'
    and (action='INSERT' or old_record->>'status' is distinct from 'published')
  group by listing_id
)
update public.listings l
set first_published_at=coalesce(p.published_at,l.created_at)
from (select l0.id,h.published_at from public.listings l0
  left join first_publish h on h.listing_id=l0.id
  where h.published_at is not null or l0.status='published') p
where l.id=p.id and l.first_published_at is null;
create or replace function private.stamp_listing_first_publication()
returns trigger language plpgsql security invoker set search_path=''
as $$
begin
  if tg_op='UPDATE' and old.first_published_at is not null then
    new.first_published_at:=old.first_published_at;
  elsif new.status='published' and new.deleted_at is null then
    new.first_published_at:=statement_timestamp();
  else
    new.first_published_at:=null;
  end if;
  return new;
end;
$$;
revoke all on function private.stamp_listing_first_publication() from public,anon,authenticated;
create or replace trigger stamp_listing_first_publication
  before insert or update on public.listings for each row
  execute function private.stamp_listing_first_publication();
comment on column public.listings.first_published_at is
  'Server-owned first publication timestamp. Edits, withdrawal and republishing never reset the 24-hour new-listing window.';
-- Existing curated whitelist and visibility decisions are unchanged; only append a public timestamp.
create or replace view public.public_listings with (security_barrier=true) as
 SELECT id,
    title,
    category,
        CASE
            WHEN unit_split THEN NULLIF(concat_ws(' '::text,
            CASE
                WHEN NOT field_visibility @> '{"building": false}'::jsonb THEN building
                ELSE NULL::text
            END,
            CASE
                WHEN NOT field_visibility @> '{"room": false}'::jsonb THEN room
                ELSE NULL::text
            END), ''::text)
            WHEN NOT field_visibility @> '{"building": false}'::jsonb AND NOT field_visibility @> '{"room": false}'::jsonb THEN unit
            ELSE NULL::text
        END AS unit,
        CASE
            WHEN NOT field_visibility @> '{"floor": false}'::jsonb THEN floor
            ELSE NULL::text
        END AS floor,
    area,
    price,
    fee,
    facing,
    layout,
    decoration,
    description,
    free_rent_period,
    supporting_facilities,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN compatible_industries
            ELSE NULL::text
        END AS compatible_industries,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN factory_height
            ELSE NULL::text
        END AS factory_height,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN factory_load
            ELSE NULL::text
        END AS factory_load,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN factory_power
            ELSE NULL::text
        END AS factory_power,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN fire_rating
            ELSE NULL::text
        END AS fire_rating,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN environmental_requirements
            ELSE NULL::text
        END AS environmental_requirements,
    images,
    videos,
    status,
    created_at,
        CASE
            WHEN NOT field_visibility @> '{"park": false}'::jsonb THEN park
            ELSE NULL::text
        END AS park,
        null::text as address,
        null::numeric as latitude,
        null::numeric as longitude,
    contact_name,
    contact_phone,
    tag,
    views,
        CASE
            WHEN unit_split AND NOT field_visibility @> '{"building": false}'::jsonb THEN building
            ELSE NULL::text
        END AS building,
        CASE
            WHEN unit_split AND NOT field_visibility @> '{"room": false}'::jsonb THEN room
            ELSE NULL::text
        END AS room,
    payment_terms,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN has_crane_support
            ELSE NULL::boolean
        END AS has_crane_support,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN freight_elevator_load
            ELSE NULL::text
        END AS freight_elevator_load,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN freight_elevator_size
            ELSE NULL::text
        END AS freight_elevator_size,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN has_passenger_elevator
            ELSE NULL::boolean
        END AS has_passenger_elevator,
        CASE
            WHEN category = ANY (ARRAY['厂房'::text, '仓储'::text]) THEN has_water
            ELSE NULL::boolean
        END AS has_water,
        CASE
            WHEN field_visibility @> '{"has_agent_fee": true}'::jsonb THEN has_agent_fee
            ELSE NULL::boolean
        END AS has_agent_fee,
        CASE
            WHEN field_visibility @> '{"wechat": true}'::jsonb THEN wechat
            ELSE NULL::text
        END AS wechat,
        CASE
            WHEN field_visibility @> '{"video_channel": true}'::jsonb THEN video_channel
            ELSE NULL::text
        END AS video_channel
    , first_published_at
   FROM public.listings
  WHERE status = 'published'::text AND deleted_at IS NULL;
do $verify$
begin
  if exists(select 1 from public.listings l full join publication_before b using(id)
    where l.id is null or b.id is null or (to_jsonb(l)-'first_published_at') is distinct from b.existing_fields)
    then raise exception 'Publication migration changed existing listing fields'; end if;
  if exists(select 1 from public.public_listings p full join publication_public_before b using(id)
    where p.id is null or b.id is null or (to_jsonb(p)-'first_published_at') is distinct from b.existing_fields)
    then raise exception 'Publication migration changed public projection'; end if;
end;
$verify$;
notify pgrst,'reload schema';
commit;
