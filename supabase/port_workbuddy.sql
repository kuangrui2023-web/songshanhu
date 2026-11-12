-- Apply once in the existing Supabase project's SQL Editor.
-- Keeps every existing listing and inquiry. Adds the public fields used by the
-- WorkBuddy-style website. Run this only after confirming that park/location/
-- contact information should be public.

alter table public.listings add column if not exists address text;
alter table public.listings add column if not exists latitude numeric;
alter table public.listings add column if not exists longitude numeric;
alter table public.listings add column if not exists contact_name text;
alter table public.listings add column if not exists contact_phone text;
alter table public.listings add column if not exists tag text;
alter table public.listings add column if not exists views integer not null default 0;

alter table public.listings drop constraint if exists publish_requires_complete_public_record;
alter table public.listings add constraint publish_requires_public_record check (
  status <> 'published' or (
    park is not null and length(trim(park)) > 0 and
    jsonb_array_length(images) >= 1
  )
);

-- PostgreSQL permits appending columns to an existing view without dropping it.
alter table public.listings add column if not exists deleted_at timestamptz;
alter table public.listings add column if not exists building text;
alter table public.listings add column if not exists room text;
alter table public.listings add column if not exists unit_split boolean not null default false;
alter table public.listings add column if not exists payment_terms text;
alter table public.listings add column if not exists has_agent_fee boolean;
alter table public.listings add column if not exists wechat text;
alter table public.listings add column if not exists video_channel text;
alter table public.listings add column if not exists has_crane_support boolean;
alter table public.listings add column if not exists freight_elevator_load text;
alter table public.listings add column if not exists freight_elevator_size text;
alter table public.listings add column if not exists has_passenger_elevator boolean;
alter table public.listings add column if not exists has_water boolean;
alter table public.listings add column if not exists field_visibility jsonb not null default '{}'::jsonb;
create or replace view public.public_listings with (security_barrier=true) as
select
  id,
  title,
  category,
  case when unit_split then nullif(concat_ws(' ',case when not (field_visibility @> '{"building":false}'::jsonb) then building end,case when not (field_visibility @> '{"room":false}'::jsonb) then room end),'') when not (field_visibility @> '{"building":false}'::jsonb) and not (field_visibility @> '{"room":false}'::jsonb) then unit end as unit,
  case when not (field_visibility @> '{"floor":false}'::jsonb) then floor end as floor,
  area,
  price,
  fee,
  facing,
  layout,
  decoration,
  description,
  free_rent_period,
  supporting_facilities,
  case when category in ('厂房','仓储') then compatible_industries end as compatible_industries,
  case when category in ('厂房','仓储') then factory_height end as factory_height,
  case when category in ('厂房','仓储') then factory_load end as factory_load,
  case when category in ('厂房','仓储') then factory_power end as factory_power,
  case when category in ('厂房','仓储') then fire_rating end as fire_rating,
  case when category in ('厂房','仓储') then environmental_requirements end as environmental_requirements,
  images,
  videos,
  status,
  created_at,
  case when not (field_visibility @> '{"park":false}'::jsonb) then park end as park,
  null::text as address,
  null::numeric as latitude,
  null::numeric as longitude,
  contact_name,
  contact_phone,
  tag,
  views,
  case when unit_split and not (field_visibility @> '{"building":false}'::jsonb) then building end as building,
  case when unit_split and not (field_visibility @> '{"room":false}'::jsonb) then room end as room,
  payment_terms,
  case when category in ('厂房','仓储') then has_crane_support end as has_crane_support,
  case when category in ('厂房','仓储') then freight_elevator_load end as freight_elevator_load,
  case when category in ('厂房','仓储') then freight_elevator_size end as freight_elevator_size,
  case when category in ('厂房','仓储') then has_passenger_elevator end as has_passenger_elevator,
  case when category in ('厂房','仓储') then has_water end as has_water,
  case when field_visibility @> '{"has_agent_fee":true}'::jsonb then has_agent_fee end as has_agent_fee,
  case when field_visibility @> '{"wechat":true}'::jsonb then wechat end as wechat,
  case when field_visibility @> '{"video_channel":true}'::jsonb then video_channel end as video_channel
from public.listings where status='published' and deleted_at is null;
revoke all on public.public_listings from anon, authenticated;
grant select on public.public_listings to anon, authenticated;
