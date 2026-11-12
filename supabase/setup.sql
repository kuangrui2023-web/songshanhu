-- Run once in the Supabase SQL editor. Then add your own auth user UUID to admin_users.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'park_admin' check (role in ('superadmin','content_admin','park_admin')),
  park text,
  active boolean not null default true,
  check ((role in ('superadmin','content_admin') and park is null) or (role = 'park_admin' and park is not null))
);
create unique index if not exists one_superadmin on public.admin_users (role) where role = 'superadmin';
alter table public.admin_users enable row level security;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.admin_users where user_id = auth.uid() and role = 'superadmin' and active); $$;
revoke all on function public.is_superadmin() from public;
grant execute on function public.is_superadmin() to authenticated;

create or replace function public.is_site_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.admin_users where user_id = auth.uid() and active); $$;
revoke all on function public.is_site_admin() from public;
grant execute on function public.is_site_admin() to authenticated;

create or replace function public.can_manage_all_parks()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admin_users where user_id=auth.uid() and active and role in ('superadmin','content_admin'));
$$;
revoke all on function public.can_manage_all_parks() from public;
grant execute on function public.can_manage_all_parks() to authenticated;

create or replace function public.can_manage_park(target_park text)
returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.admin_users where user_id=auth.uid() and active and (role in ('superadmin','content_admin') or park=target_park));
$$;
revoke all on function public.can_manage_park(text) from public;
grant execute on function public.can_manage_park(text) to authenticated;


drop policy if exists "admins can see their own membership" on public.admin_users;
create policy "admins can see own or superadmin all" on public.admin_users
  for select to authenticated using (user_id = auth.uid() or public.is_superadmin());
create policy "superadmin manages admin accounts" on public.admin_users
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

create table if not exists public.listings (
  id uuid primary key,
  title text not null,
  category text not null default '写字楼',
  park text,
  unit text,
  floor text,
  area numeric,
  price numeric,
  fee numeric,
  facing text,
  layout text,
  decoration text,
  description text,
  free_rent_period text,
  supporting_facilities text,
  compatible_industries text,
  factory_height text,
  factory_load text,
  factory_power text,
  fire_rating text,
  environmental_requirements text,
  internal_code text,
  owner_floor_price numeric,
  channel_notes text,
  followup_notes text,
  address text,
  latitude numeric,
  longitude numeric,
  contact_name text,
  contact_phone text,
  tag text,
  views integer not null default 0,
  images jsonb not null default '[]'::jsonb,
  videos jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publish_requires_public_record check (
    status <> 'published' or (
      park is not null and length(trim(park)) > 0 and
      jsonb_array_length(images) >= 1
    )
  )
);
alter table public.listings enable row level security;
-- The base table contains private owner and channel fields. Public fields are
-- whitelisted through the view below; the operator chose to publish park details.
create policy "admins can read their own parks" on public.listings
  for select to authenticated using (public.can_manage_park(park));
create policy "admins can insert listings" on public.listings
  for insert to authenticated with check (public.can_manage_park(park));
create policy "admins can update listings" on public.listings
  for update to authenticated using (public.can_manage_park(park)) with check (public.can_manage_park(park));
create policy "admins can delete listings" on public.listings
  for delete to authenticated using (public.can_manage_park(park));
revoke all on public.listings from anon;
grant select on public.listings to authenticated;
grant insert, update, delete on public.listings to authenticated;
grant select on public.admin_users to authenticated;

-- Only the following whitelisted columns are ever returned to the public website.
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

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.listings(id) on delete set null,
  request_text text,
  company text not null,
  contact text not null,
  phone text not null,
  viewing_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.inquiries enable row level security;
create policy "visitors can submit inquiry" on public.inquiries
  for insert to anon, authenticated with check (length(company) between 1 and 80 and length(contact) between 1 and 40 and phone ~ '^1[0-9]{10}$');
create policy "admins can read inquiry for their park" on public.inquiries
  for select to authenticated using (
    public.can_manage_all_parks() or exists (
      select 1 from public.listings l where l.id = listing_id and public.can_manage_park(l.park)
    )
  );
grant insert on public.inquiries to anon, authenticated;
grant select on public.inquiries to authenticated;

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  listing_id uuid,
  actor_id uuid,
  action text not null,
  old_record jsonb,
  new_record jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "superadmin reads audit logs" on public.audit_logs
  for select to authenticated using (public.is_superadmin());
grant select on public.audit_logs to authenticated;
create or replace function public.log_listing_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.audit_logs(listing_id, actor_id, action, old_record, new_record)
  values (case when tg_op = 'DELETE' then old.id else new.id end, auth.uid(), tg_op,
          case when tg_op = 'INSERT' then null else to_jsonb(old) end,
          case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists listings_audit on public.listings;
create trigger listings_audit after insert or update or delete on public.listings
  for each row execute function public.log_listing_change();

insert into storage.buckets (id, name, public)
values ('listing-media', 'listing-media', true)
on conflict (id) do update set public = true;
create policy "visitors can view listing media" on storage.objects
  for select to anon, authenticated using (bucket_id = 'listing-media');
create policy "admins can upload listing media" on storage.objects
  for insert to authenticated with check (bucket_id = 'listing-media' and public.is_site_admin());
create policy "admins can remove listing media" on storage.objects
  for delete to authenticated using (bucket_id = 'listing-media' and public.is_superadmin());
