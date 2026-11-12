-- 松山湖产业招商网站：全新 Supabase 项目一键建库脚本
-- 由 scripts/build-bootstrap.mjs 按文档顺序合并生成，请勿手工编辑。
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全文 → Run。

-- ==================== setup.sql ====================
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

-- ==================== admin_workspace.sql ====================
-- Additive upgrade for the existing site. No demo data and no record deletion.
begin;

alter table public.admin_users add column if not exists display_name text not null default '';
alter table public.admin_users add column if not exists created_at timestamptz not null default now();
alter table public.listings add column if not exists withdrawn_at timestamptz;
alter table public.listings add column if not exists deleted_at timestamptz;
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
alter table public.inquiries add column if not exists status text not null default 'pending' check (status in ('pending','replied','closed'));
alter table public.inquiries add column if not exists reply text not null default '';
alter table public.inquiries add column if not exists replied_at timestamptz;
alter table public.inquiries add column if not exists receipt uuid unique;
alter table public.inquiries add column if not exists deleted_at timestamptz;

create table if not exists public.site_settings (
  id boolean primary key default true check(id),
  platform_name text not null default '松山湖产业招商' check(length(platform_name) between 1 and 60),
  hotline text not null default '' check(length(hotline)<=40),
  admin_limit integer not null default 5 check(admin_limit between 1 and 20),
  share_title text not null default '' check(length(share_title)<=120),
  share_description text not null default '' check(length(share_description)<=240),
  share_image text not null default '' check(share_image='' or share_image like 'https://%'),
  updated_at timestamptz not null default now()
);
insert into public.site_settings(id) values(true) on conflict do nothing;
alter table public.site_settings enable row level security;
drop policy if exists "public site parameters" on public.site_settings;
create policy "public site parameters" on public.site_settings for select to anon,authenticated using(true);
grant select on public.site_settings to anon,authenticated;
revoke insert,update,delete on public.site_settings from anon,authenticated;

create table if not exists public.parks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check(length(trim(name)) between 1 and 120),
  address text not null default '' check(length(address)<=300),
  latitude numeric check(latitude between -90 and 90),
  longitude numeric check(longitude between -180 and 180),
  contact_name text not null default '' check(length(contact_name)<=60),
  contact_phone text not null default '' check(length(contact_phone)<=40),
  description text not null default '' check(length(description)<=4000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((latitude is null)=(longitude is null))
);
-- Import only names already present in real records; do not invent addresses or coordinates.
insert into public.parks(name) select distinct trim(park) from public.listings
 where park is not null and length(trim(park))>0 on conflict(name) do nothing;
alter table public.parks enable row level security;
drop policy if exists "public active parks" on public.parks;
create policy "public active parks" on public.parks for select to anon,authenticated using(active);
drop policy if exists "superadmin all parks" on public.parks;
create policy "superadmin all parks" on public.parks for select to authenticated using(public.is_superadmin());
grant select on public.parks to anon,authenticated;
revoke insert,update,delete on public.parks from anon,authenticated;

create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  visitor_id uuid not null, session_id uuid not null,
  kind text not null check(kind in ('visit','listing_view')),
  listing_id uuid references public.listings(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists site_events_session_unique on public.site_events
 (session_id,kind,coalesce(listing_id,'00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists site_events_time on public.site_events(created_at);
alter table public.site_events enable row level security;
revoke all on public.site_events from anon,authenticated;

create or replace function public.record_site_event(p_visitor uuid,p_session uuid,p_kind text,p_listing uuid default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_visitor is null or p_session is null or p_kind not in ('visit','listing_view') then return; end if;
 if p_kind='listing_view' and not exists(select 1 from listings where id=p_listing and status='published' and deleted_at is null) then return; end if;
 if p_kind='visit' then p_listing:=null; end if;
 if (select count(*) from site_events where session_id=p_session)>=200 then return; end if;
 insert into site_events(visitor_id,session_id,kind,listing_id) values(p_visitor,p_session,p_kind,p_listing) on conflict do nothing;
end; $$;
revoke all on function public.record_site_event(uuid,uuid,text,uuid) from public;
grant execute on function public.record_site_event(uuid,uuid,text,uuid) to anon,authenticated;

create or replace function public.submit_site_inquiry(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r inquiries; lid uuid;
begin
 lid:=nullif(p_payload->>'listing_id','')::uuid;
 if lid is not null and not exists(select 1 from listings where id=lid and status='published' and deleted_at is null) then raise exception '该房源当前不可咨询'; end if;
 if length(trim(coalesce(p_payload->>'contact',''))) not between 1 and 40
 or coalesce(p_payload->>'phone','') !~ '^1[0-9]{10}$'
 or length(trim(coalesce(p_payload->>'company',''))) not between 1 and 80
 or length(coalesce(p_payload->>'request_text',''))>4000 then raise exception '请检查称呼、手机号和留言内容'; end if;
 if (select count(*) from inquiries where phone=p_payload->>'phone' and created_at>now()-interval '1 hour')>=10 then raise exception '提交过于频繁，请稍后再试'; end if;
 insert into inquiries(listing_id,company,contact,phone,request_text,viewing_at,receipt)
 values(lid,trim(p_payload->>'company'),trim(p_payload->>'contact'),p_payload->>'phone',p_payload->>'request_text',nullif(p_payload->>'viewing_at','')::timestamptz,gen_random_uuid()) returning * into r;
 return jsonb_build_object('id',r.id,'receipt',r.receipt);
end; $$;
revoke all on function public.submit_site_inquiry(jsonb) from public;
grant execute on function public.submit_site_inquiry(jsonb) to anon,authenticated;

create or replace function public.read_site_reply(p_receipt uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select jsonb_build_object('status',status,'reply',reply,'replied_at',replied_at)
 from inquiries where receipt=p_receipt and deleted_at is null;
$$;
revoke all on function public.read_site_reply(uuid) from public;
grant execute on function public.read_site_reply(uuid) to anon,authenticated;

create or replace function public.manage_site_inquiry(p_id uuid,p_status text,p_reply text,p_archived boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not public.is_site_admin() or not exists(select 1 from inquiries q where q.id=p_id and
  (public.can_manage_all_parks() or exists(select 1 from listings l where l.id=q.listing_id and public.can_manage_park(l.park)))) then raise exception '无权处理这条留言'; end if;
 if p_status not in ('pending','replied','closed') or length(coalesce(p_reply,''))>4000 then raise exception '留言状态或回复内容不正确'; end if;
 if p_status='replied' and length(trim(coalesce(p_reply,'')))=0 then raise exception '请填写回复内容'; end if;
 update inquiries set status=p_status,reply=coalesce(p_reply,''),replied_at=case when length(trim(coalesce(p_reply,'')))>0 then now() else null end,
 deleted_at=case when p_archived then now() else null end where id=p_id;
end; $$;
revoke all on function public.manage_site_inquiry(uuid,text,text,boolean) from public;
grant execute on function public.manage_site_inquiry(uuid,text,text,boolean) to authenticated;

create or replace function public.save_site_park(p_park jsonb)
returns public.parks language plpgsql security definer set search_path=public as $$
declare old_name text; pid uuid; r parks;
begin
 if not public.is_superadmin() then raise exception '仅超级管理员可管理园区'; end if;
 perform pg_advisory_xact_lock(20261019,1);
 pid:=coalesce(nullif(p_park->>'id','')::uuid,gen_random_uuid());
 select name into old_name from parks where id=pid for update;
 if length(trim(coalesce(p_park->>'name',''))) not between 1 and 120 then raise exception '请填写园区名称'; end if;
 if coalesce((p_park->>'active')::boolean,true)=false and old_name is not null and
 (exists(select 1 from listings where park=old_name) or exists(select 1 from admin_users where park=old_name)) then raise exception '该园区仍关联房源或管理员，请先调整关联信息'; end if;
 insert into parks(id,name,address,latitude,longitude,contact_name,contact_phone,description,active)
 values(pid,trim(p_park->>'name'),coalesce(p_park->>'address',''),nullif(p_park->>'latitude','')::numeric,nullif(p_park->>'longitude','')::numeric,
 coalesce(p_park->>'contact_name',''),coalesce(p_park->>'contact_phone',''),coalesce(p_park->>'description',''),coalesce((p_park->>'active')::boolean,true))
 on conflict(id) do update set name=excluded.name,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,
 contact_name=excluded.contact_name,contact_phone=excluded.contact_phone,description=excluded.description,active=excluded.active,updated_at=now()
 returning * into r;
 if old_name is not null and old_name<>r.name then
  update listings set park=r.name,updated_at=now() where park=old_name;
  update admin_users set park=r.name where park=old_name;
 end if;
 return r;
end; $$;
revoke all on function public.save_site_park(jsonb) from public;
grant execute on function public.save_site_park(jsonb) to authenticated;

create or replace function public.save_site_settings(p_settings jsonb)
returns public.site_settings language plpgsql security definer set search_path=public as $$
declare r site_settings; lim integer;
begin
 if not public.is_superadmin() then raise exception '仅超级管理员可修改平台设置'; end if;
 perform pg_advisory_xact_lock(20261019,2);
 lim:=(p_settings->>'admin_limit')::integer;
 if lim<(select count(*) from admin_users) then raise exception '管理员上限不能低于现有账号数'; end if;
 update site_settings set platform_name=trim(p_settings->>'platform_name'),hotline=coalesce(p_settings->>'hotline',''),admin_limit=lim,
 share_title=coalesce(p_settings->>'share_title',''),share_description=coalesce(p_settings->>'share_description',''),share_image=coalesce(p_settings->>'share_image',''),updated_at=now()
 where id returning * into r;
 return r;
end; $$;
revoke all on function public.save_site_settings(jsonb) from public;
grant execute on function public.save_site_settings(jsonb) to authenticated;

create or replace function public.site_admin_directory()
returns table(user_id uuid,display_name text,email text,role text,park text,active boolean,created_at timestamptz,last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
begin
 if not public.is_site_admin() then raise exception '请先登录管理后台'; end if;
 return query select a.user_id,a.display_name,u.email::text,a.role,a.park,a.active,a.created_at,u.last_sign_in_at
 from admin_users a join auth.users u on u.id=a.user_id where public.is_superadmin() or a.user_id=auth.uid() order by a.created_at;
end; $$;
revoke all on function public.site_admin_directory() from public;
grant execute on function public.site_admin_directory() to authenticated;

-- Account permissions are managed transactionally; the sole superadmin cannot be removed or demoted.
create or replace function public.manage_site_admin(p_action text,p_email text default null,p_user uuid default null,p_name text default '',p_park text default null,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare target uuid; a admin_users; lim integer; all_parks boolean := coalesce(p_park='__all_parks__',false);
begin
 if not public.is_superadmin() then raise exception '仅超级管理员可管理账号'; end if;
 perform pg_advisory_xact_lock(20261019,2);
 target:=p_user;
 if p_action='add' then
  select id into target from auth.users where lower(email)=lower(trim(p_email));
  if target is null then raise exception '该邮箱尚未创建登录账号，请先使用新增账号功能'; end if;
  if exists(select 1 from admin_users where user_id=target) then raise exception '该账号已在管理员列表中'; end if;
  select admin_limit into lim from site_settings where id;
  if (select count(*) from admin_users)>=lim then raise exception '管理员数量已达上限'; end if;
  if not all_parks and not exists(select 1 from parks where name=p_park and active) then raise exception '请选择一个启用的园区'; end if;
  insert into admin_users(user_id,role,park,active,display_name) values(target,case when all_parks then 'content_admin' else 'park_admin' end,case when all_parks then null else p_park end,true,left(trim(p_name),60));
 elsif p_action in ('update','remove') then
  select * into a from admin_users where user_id=target for update;
  if not found then raise exception '管理员不存在'; end if;
  if a.role='superadmin' then
   if p_action='remove' or not p_active then raise exception '不能移除或停用超级管理员'; end if;
   update admin_users set display_name=left(trim(p_name),60) where user_id=target;
  elsif p_action='remove' then delete from admin_users where user_id=target;
  else
   if not all_parks and not exists(select 1 from parks where name=p_park and active) then raise exception '请选择一个启用的园区'; end if;
   update admin_users set display_name=left(trim(p_name),60),role=case when all_parks then 'content_admin' else 'park_admin' end,park=case when all_parks then null else p_park end,active=p_active where user_id=target;
  end if;
 else raise exception '不支持的账号操作'; end if;
 return target;
end; $$;
revoke all on function public.manage_site_admin(text,text,uuid,text,text,boolean) from public;
grant execute on function public.manage_site_admin(text,text,uuid,text,text,boolean) to authenticated;

create or replace function public.site_admin_metrics()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.is_site_admin() then raise exception '请先登录管理后台'; end if;
 with scoped as (
  select e.* from site_events e where public.can_manage_all_parks() or exists(select 1 from listings l where l.id=e.listing_id and public.can_manage_park(l.park))
 ), days as (
  select generate_series((now() at time zone 'Asia/Shanghai')::date-6,(now() at time zone 'Asia/Shanghai')::date,interval '1 day')::date as day
 ), trend as (
  select d.day,count(distinct s.visitor_id) filter(where s.kind='visit' or not public.can_manage_all_parks()) as visitors,
   count(s.id) filter(where s.kind='listing_view') as views
  from days d left join scoped s on (s.created_at at time zone 'Asia/Shanghai')::date=d.day group by d.day order by d.day
 ), top_items as (
  select l.id,l.title,count(s.id) as views from listings l join scoped s on s.listing_id=l.id and s.kind='listing_view'
  group by l.id,l.title order by views desc,l.title limit 5
 ) select jsonb_build_object(
  'visitors',(select count(distinct visitor_id) from scoped where kind='visit' or not public.can_manage_all_parks()),
  'views',(select count(*) from scoped where kind='listing_view'),
  'today_visitors',(select count(distinct visitor_id) from scoped where (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date and (kind='visit' or not public.can_manage_all_parks())),
  'today_views',(select count(*) from scoped where kind='listing_view' and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date),
  'since',(select min(created_at) from site_events),
  'trend',coalesce((select jsonb_agg(to_jsonb(t)) from trend t),'[]'::jsonb),
  'top',coalesce((select jsonb_agg(to_jsonb(t)) from top_items t),'[]'::jsonb)
 ) into result;
 return result;
end; $$;
revoke all on function public.site_admin_metrics() from public;
grant execute on function public.site_admin_metrics() to authenticated;

notify pgrst,'reload schema';
commit;

-- ==================== visitor_intake.sql ====================
-- Unified visitor intake. Additive; keeps all existing records.
begin;
alter table public.inquiries add column if not exists kind text not null default 'inquiry' check(kind in ('inquiry','company','need'));
alter table public.inquiries add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.inquiries add column if not exists client_request_id uuid;
create index if not exists inquiries_phone_time on public.inquiries(phone,created_at);
create unique index if not exists inquiries_request_id_unique on public.inquiries(client_request_id) where client_request_id is not null;

create or replace function public.submit_site_inquiry(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r inquiries; lid uuid; rid uuid; k text; ph text; co text; who text; msg text; d jsonb; raw_d jsonb; v_at timestamptz;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>16000 then raise exception '提交内容格式不正确或过长'; end if;
 k:=coalesce(p_payload->>'kind','inquiry');
 if k not in ('inquiry','company','need') then raise exception '不支持的提交类型'; end if;
 if coalesce((p_payload->>'consent')::boolean,false) is not true then raise exception '请确认同意用于本次招商联系'; end if;
 rid:=nullif(p_payload->>'client_request_id','')::uuid;
 if rid is null then raise exception '请刷新网页后重新提交'; end if;
 ph:=trim(coalesce(p_payload->>'phone','')); who:=trim(coalesce(p_payload->>'contact',''));
 co:=trim(coalesce(p_payload->>'company','')); msg:=trim(coalesce(p_payload->>'request_text',''));
 if length(who) not between 1 and 40 or ph !~ '^1[3-9][0-9]{9}$' or length(co) not between 1 and 80 or length(msg) not between 4 and 4000 then raise exception '请检查称呼、手机号、企业名称和内容长度'; end if;
 if coalesce(p_payload->>'website','')<>'' then raise exception '提交未完成，请稍后重试'; end if;
 -- Serialize rate limit and idempotency decisions; no client-supplied identity grants access.
 perform pg_advisory_xact_lock(20261019,3);
 select * into r from inquiries where client_request_id=rid;
 if found then
  if r.phone=ph and r.kind=k and r.company=co and r.contact=who and r.request_text=msg and r.details=coalesce(p_payload->'details','{}'::jsonb) then
   return jsonb_build_object('id',r.id,'receipt',r.receipt);
  end if;
  raise exception '提交标识已使用，请重新打开表单';
 end if;
 if (select count(*) from inquiries where phone=ph and created_at>now()-interval '1 hour')>=10
 or exists(select 1 from inquiries where phone=ph and created_at>now()-interval '10 seconds') then raise exception '提交过于频繁，请稍后再试'; end if;
 if (select count(*) from inquiries where created_at>now()-interval '1 minute')>=120 then raise exception '当前提交较多，请一分钟后重试'; end if;
 lid:=nullif(p_payload->>'listing_id','')::uuid;
 if lid is not null and (k<>'inquiry' or not exists(select 1 from listings where id=lid and status='published' and deleted_at is null)) then raise exception '该房源当前不可咨询'; end if;
 raw_d:=coalesce(p_payload->'details','{}'::jsonb);
 if jsonb_typeof(raw_d) is distinct from 'object' then raise exception '资料格式不正确'; end if;
 if k='company' then
  if length(trim(coalesce(raw_d->>'name',''))) not between 1 and 80 or raw_d->>'name'<>co
  or length(coalesce(raw_d->>'industry',''))>60 or length(coalesce(raw_d->>'product',''))>200 or length(coalesce(raw_d->>'intro',''))>500 then raise exception '请检查企业资料长度'; end if;
  d:=jsonb_build_object('name',co,'industry',coalesce(raw_d->>'industry',''),'product',coalesce(raw_d->>'product',''),'intro',coalesce(raw_d->>'intro',''));
 elsif k='need' then
  if length(trim(coalesce(raw_d->>'type',''))) not between 1 and 40 or length(trim(coalesce(raw_d->>'description',''))) not between 4 and 300 then raise exception '需求描述须为4至300字'; end if;
  d:=jsonb_build_object('type',raw_d->>'type','description',trim(raw_d->>'description'));
 else d:='{}'::jsonb; end if;
 v_at:=nullif(p_payload->>'viewing_at','')::timestamptz;
 if v_at is not null and (v_at<now()-interval '1 hour' or v_at>now()+interval '1 year') then raise exception '请填写未来一年内的看房时间'; end if;
 insert into inquiries(listing_id,company,contact,phone,request_text,viewing_at,receipt,kind,details,client_request_id)
 values(lid,co,who,ph,msg,v_at,gen_random_uuid(),k,d,rid) returning * into r;
 return jsonb_build_object('id',r.id,'receipt',r.receipt);
end; $$;
revoke all on function public.submit_site_inquiry(jsonb) from public;
grant execute on function public.submit_site_inquiry(jsonb) to anon,authenticated;
-- Close the old direct insert path; server-generated status/reply/receipt cannot be supplied by visitors.
drop policy if exists "visitors can submit inquiry" on public.inquiries;
revoke insert,update,delete on public.inquiries from anon,authenticated;
notify pgrst,'reload schema';
commit;

-- ==================== visitor_withdraw.sql ====================
-- Receipt-scoped, recoverable visitor withdrawal. No records are purged.
begin;
alter table public.inquiries add column if not exists visitor_withdrawn_at timestamptz;

create or replace function public.withdraw_site_inquiry(p_id uuid,p_receipt uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.inquiries;
begin
 if p_id is null or p_receipt is null then raise exception '缺少留言回执，无法撤回'; end if;
 select * into r from public.inquiries where id=p_id and receipt=p_receipt for update;
 if not found then raise exception '未找到对应留言，请保留内容并联系招商顾问'; end if;
 if r.visitor_withdrawn_at is null then
  update public.inquiries set visitor_withdrawn_at=now(),deleted_at=coalesce(deleted_at,now()),status='closed'
  where id=r.id returning * into r;
 end if;
 return jsonb_build_object('id',r.id,'withdrawn',true,'withdrawn_at',r.visitor_withdrawn_at);
end; $$;
revoke all on function public.withdraw_site_inquiry(uuid,uuid) from public;
grant execute on function public.withdraw_site_inquiry(uuid,uuid) to anon,authenticated;

create or replace function public.read_site_reply(p_receipt uuid)
returns jsonb language sql stable security definer set search_path=public as $$
 select case when visitor_withdrawn_at is not null then jsonb_build_object('withdrawn',true)
 else jsonb_build_object('status',status,'reply',reply,'replied_at',replied_at) end
 from public.inquiries where receipt=p_receipt and (deleted_at is null or visitor_withdrawn_at is not null);
$$;
revoke all on function public.read_site_reply(uuid) from public;
grant execute on function public.read_site_reply(uuid) to anon,authenticated;

-- Preserve withdrawal when staff open a stale tab or try to restore a row.
create or replace function public.manage_site_inquiry(p_id uuid,p_status text,p_reply text,p_archived boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare r public.inquiries;
begin
 if not public.is_site_admin() or not exists(select 1 from public.inquiries q where q.id=p_id and
  (public.can_manage_all_parks() or exists(select 1 from public.listings l where l.id=q.listing_id and public.can_manage_park(l.park)))) then raise exception '无权处理这条留言'; end if;
 select * into r from public.inquiries where id=p_id for update;
 if r.visitor_withdrawn_at is not null then raise exception '访客已撤回这条留言，请刷新列表，以新提交的留言为准'; end if;
 if p_status not in ('pending','replied','closed') or length(coalesce(p_reply,''))>4000 then raise exception '留言状态或回复内容不正确'; end if;
 if p_status='replied' and length(trim(coalesce(p_reply,'')))=0 then raise exception '请填写回复内容'; end if;
 update public.inquiries set status=p_status,reply=coalesce(p_reply,''),replied_at=case when length(trim(coalesce(p_reply,'')))>0 then now() else null end,
 deleted_at=case when p_archived then now() else null end where id=p_id;
end; $$;
revoke all on function public.manage_site_inquiry(uuid,text,text,boolean) from public;
grant execute on function public.manage_site_inquiry(uuid,text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;

-- ==================== admin_all_parks.sql ====================
-- Explicit all-park CONTENT scope; existing accounts are not upgraded automatically.
begin;
alter table public.admin_users drop constraint admin_users_role_check;
alter table public.admin_users add constraint admin_users_role_check check(role in ('superadmin','content_admin','park_admin'));
alter table public.admin_users drop constraint admin_users_check;
alter table public.admin_users add constraint admin_users_check check(
 (role in ('superadmin','content_admin') and park is null) or (role='park_admin' and park is not null)
);

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

create or replace function public.manage_site_admin(p_action text,p_email text default null,p_user uuid default null,p_name text default '',p_park text default null,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare target uuid; a admin_users; lim integer; all_parks boolean := coalesce(p_park='__all_parks__',false);
begin
 if not public.is_superadmin() then raise exception '仅超级管理员可管理账号'; end if;
 perform pg_advisory_xact_lock(20261019,2);
 target:=p_user;
 if p_action='add' then
  select id into target from auth.users where lower(email)=lower(trim(p_email));
  if target is null then raise exception '该邮箱尚未创建登录账号，请先使用新增账号功能'; end if;
  if exists(select 1 from admin_users where user_id=target) then raise exception '该账号已在管理员列表中'; end if;
  select admin_limit into lim from site_settings where id;
  if (select count(*) from admin_users)>=lim then raise exception '管理员数量已达上限'; end if;
  if not all_parks and not exists(select 1 from parks where name=p_park and active) then raise exception '请选择一个启用的园区'; end if;
  insert into admin_users(user_id,role,park,active,display_name) values(target,case when all_parks then 'content_admin' else 'park_admin' end,case when all_parks then null else p_park end,true,left(trim(p_name),60));
 elsif p_action in ('update','remove') then
  select * into a from admin_users where user_id=target for update;
  if not found then raise exception '管理员不存在'; end if;
  if a.role='superadmin' then
   if p_action='remove' or not p_active then raise exception '不能移除或停用超级管理员'; end if;
   update admin_users set display_name=left(trim(p_name),60) where user_id=target;
  elsif p_action='remove' then delete from admin_users where user_id=target;
  else
   if not all_parks and not exists(select 1 from parks where name=p_park and active) then raise exception '请选择一个启用的园区'; end if;
   update admin_users set display_name=left(trim(p_name),60),role=case when all_parks then 'content_admin' else 'park_admin' end,park=case when all_parks then null else p_park end,active=p_active where user_id=target;
  end if;
 else raise exception '不支持的账号操作'; end if;
 return target;
end; $$;
revoke all on function public.manage_site_admin(text,text,uuid,text,text,boolean) from public;
grant execute on function public.manage_site_admin(text,text,uuid,text,text,boolean) to authenticated;

drop policy if exists "admins can read inquiry for their park" on public.inquiries;
create policy "admins can read inquiry for their park" on public.inquiries
 for select to authenticated using (
  public.can_manage_all_parks() or exists(select 1 from public.listings l where l.id=listing_id and public.can_manage_park(l.park))
 );

create or replace function public.manage_site_inquiry(p_id uuid,p_status text,p_reply text,p_archived boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare r public.inquiries;
begin
 if not public.is_site_admin() or not exists(select 1 from public.inquiries q where q.id=p_id and
  (public.can_manage_all_parks() or exists(select 1 from public.listings l where l.id=q.listing_id and public.can_manage_park(l.park)))) then raise exception '无权处理这条留言'; end if;
 select * into r from public.inquiries where id=p_id for update;
 if r.visitor_withdrawn_at is not null then raise exception '访客已撤回这条留言，请刷新列表，以新提交的留言为准'; end if;
 if p_status not in ('pending','replied','closed') or length(coalesce(p_reply,''))>4000 then raise exception '留言状态或回复内容不正确'; end if;
 if p_status='replied' and length(trim(coalesce(p_reply,'')))=0 then raise exception '请填写回复内容'; end if;
 update public.inquiries set status=p_status,reply=coalesce(p_reply,''),replied_at=case when length(trim(coalesce(p_reply,'')))>0 then now() else null end,
 deleted_at=case when p_archived then now() else null end where id=p_id;
end; $$;
revoke all on function public.manage_site_inquiry(uuid,text,text,boolean) from public;
grant execute on function public.manage_site_inquiry(uuid,text,text,boolean) to authenticated;
create or replace function public.site_admin_metrics()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 if not public.is_site_admin() then raise exception '请先登录管理后台'; end if;
 with scoped as (
  select e.* from site_events e where public.can_manage_all_parks() or exists(select 1 from listings l where l.id=e.listing_id and public.can_manage_park(l.park))
 ), days as (
  select generate_series((now() at time zone 'Asia/Shanghai')::date-6,(now() at time zone 'Asia/Shanghai')::date,interval '1 day')::date as day
 ), trend as (
  select d.day,count(distinct s.visitor_id) filter(where s.kind='visit' or not public.can_manage_all_parks()) as visitors,
   count(s.id) filter(where s.kind='listing_view') as views
  from days d left join scoped s on (s.created_at at time zone 'Asia/Shanghai')::date=d.day group by d.day order by d.day
 ), top_items as (
  select l.id,l.title,count(s.id) as views from listings l join scoped s on s.listing_id=l.id and s.kind='listing_view'
  group by l.id,l.title order by views desc,l.title limit 5
 ) select jsonb_build_object(
  'visitors',(select count(distinct visitor_id) from scoped where kind='visit' or not public.can_manage_all_parks()),
  'views',(select count(*) from scoped where kind='listing_view'),
  'today_visitors',(select count(distinct visitor_id) from scoped where (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date and (kind='visit' or not public.can_manage_all_parks())),
  'today_views',(select count(*) from scoped where kind='listing_view' and (created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date),
  'since',(select min(created_at) from site_events),
  'trend',coalesce((select jsonb_agg(to_jsonb(t)) from trend t),'[]'::jsonb),
  'top',coalesce((select jsonb_agg(to_jsonb(t)) from top_items t),'[]'::jsonb)
 ) into result;
 return result;
end; $$;
revoke all on function public.site_admin_metrics() from public;
grant execute on function public.site_admin_metrics() to authenticated;

alter table public.parks drop constraint if exists parks_scope_name_check;
alter table public.parks add constraint parks_scope_name_check check(name <> '__all_parks__');

-- Import names already used by actual listings; do not infer addresses/coordinates.
insert into public.parks(name)
 select distinct park from public.listings
 where deleted_at is null and park is not null and length(trim(park)) between 1 and 120
 on conflict(name) do nothing;

create schema if not exists private;
create or replace function private.sync_listing_park_directory()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.park='__all_parks__' then raise exception '房源必须填写真实园区名称'; end if;
 if new.park is not null and length(trim(new.park)) between 1 and 120 then
  insert into public.parks(name) values(new.park) on conflict(name) do nothing;
 end if;
 return new;
end; $$;
revoke all on function private.sync_listing_park_directory() from public,anon,authenticated;
drop trigger if exists sync_listing_park_directory on public.listings;
create trigger sync_listing_park_directory after insert or update of park on public.listings
 for each row execute function private.sync_listing_park_directory();

notify pgrst,'reload schema';
commit;

-- ==================== listing_editor_fields.sql ====================
-- Additive listing editor upgrade. No listing/account records are rewritten.
-- The base table remains admin scoped. This curated published-only view is
-- deliberately owner-executed: public clients have no access to private columns.
begin;
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
alter table public.listings drop constraint if exists listing_visibility_object;
alter table public.listings add constraint listing_visibility_object check (
  jsonb_typeof(field_visibility)='object'
  and field_visibility - array['park','building','floor','room','address','coordinates','has_agent_fee','wechat','video_channel'] = '{}'::jsonb
  and coalesce(jsonb_typeof(field_visibility->'park')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'building')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'floor')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'room')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'address')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'coordinates')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'has_agent_fee')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'wechat')='boolean',true)
  and coalesce(jsonb_typeof(field_visibility->'video_channel')='boolean',true)
);
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
notify pgrst, 'reload schema';
commit;

-- ==================== listing_internal_codes.sql ====================
-- Automatic six-digit internal codes. Existing non-empty codes are immutable.
-- No existing listing is rewritten. Public projections must exclude internal_code.
create sequence if not exists private.listing_internal_code_seq
  as integer start with 100001 minvalue 100001 maxvalue 999999 no cycle;

create unique index if not exists listings_six_digit_internal_code_key
  on public.listings (internal_code)
  where internal_code ~ '^[0-9]{6}$';

create or replace function private.assign_listing_internal_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_code text;
  candidate text;
begin
  -- The trigger does not grant write access: the table's existing RLS still applies.
  -- Only active administrators may trigger allocation through the Data API.
  if current_setting('role', true) in ('anon', 'authenticated')
     and (auth.uid() is null or not public.is_site_admin()) then
    raise insufficient_privilege using message = '仅管理员可保存房源。';
  end if;

  if tg_op = 'INSERT' then
    -- PostgREST saves with INSERT ... ON CONFLICT DO UPDATE. Preserve its code
    -- before the insert attempt; an empty existing code is allocated on UPDATE.
    select l.internal_code into existing_code
      from public.listings as l where l.id = new.id;
    if found then
      new.internal_code := existing_code;
      return new;
    end if;
  elsif nullif(btrim(old.internal_code), '') is not null then
    new.internal_code := old.internal_code;
    return new;
  end if;

  -- nextval is atomic across administrators and tabs. Never recycle codes.
  loop
    begin
      candidate := nextval('private.listing_internal_code_seq'::regclass)::text;
    exception when sequence_generator_limit_exceeded then
      raise exception using errcode = 'P0001',
        message = '六位房源编号已用尽，请联系管理员扩展编号规则。';
    end;
    exit when not exists (
      select 1 from public.listings as l where l.internal_code = candidate
    );
  end loop;
  new.internal_code := candidate;
  return new;
end;
$$;

revoke all on sequence private.listing_internal_code_seq from public, anon, authenticated;
revoke all on function private.assign_listing_internal_code() from public, anon, authenticated;

create or replace trigger assign_listing_internal_code
  before insert or update on public.listings
  for each row execute function private.assign_listing_internal_code();

comment on sequence private.listing_internal_code_seq is
  'Six-digit private listing identifiers, allocated on first save; gaps are allowed and codes are never reused.';

-- ==================== listing_first_publication.sql ====================
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

-- ==================== location_privacy.sql ====================
-- Keep original private records and every unrelated public field unchanged.
begin;
create temporary table location_public_before on commit drop as
  select id,to_jsonb(p)-array['address','latitude','longitude'] as payload
  from public.public_listings p;
create temporary table location_private_before on commit drop as
  select id,md5(to_jsonb(l)::text) as digest from public.listings l;

do $$
declare definition text := pg_get_viewdef('public.public_listings'::regclass,true);
        column_name text; pattern text; replacement text;
begin
  foreach column_name in array array['address','latitude','longitude'] loop
    pattern := format('CASE[[:space:]]+WHEN NOT field_visibility @> ''%s''::jsonb THEN %s[[:space:]]+ELSE NULL::%s[[:space:]]+END AS %s',
      case when column_name='address' then '{"address": false}' else '{"coordinates": false}' end,
      column_name,case when column_name='address' then 'text' else 'numeric' end,column_name);
    replacement := format('NULL::%s AS %I',case when column_name='address' then 'text' else 'numeric' end,column_name);
    if definition ~ pattern then
      definition := regexp_replace(definition,pattern,replacement);
    elsif definition !~* format('NULL::%s AS %I',case when column_name='address' then 'text' else 'numeric' end,column_name) then
      raise exception 'Unexpected public projection for %; inspect before modifying',column_name;
    end if;
  end loop;
  execute 'create or replace view public.public_listings with (security_barrier=true) as '||definition;
end $$;

-- Only the public catalog columns are available without an admin session.
revoke all on public.parks from anon;
grant select(id,name,active) on public.parks to anon;
drop policy if exists "public active parks" on public.parks;
create policy "public active parks" on public.parks for select to anon using(active);
drop policy if exists "admins active parks" on public.parks;
create policy "admins active parks" on public.parks for select to authenticated
  using(active and (select public.is_site_admin()));

do $$ begin
  if exists(select 1 from public.public_listings where address is not null or latitude is not null or longitude is not null)
    then raise exception 'Private locations still exposed'; end if;
  if exists(select 1 from public.public_listings p full join location_public_before b using(id)
    where (to_jsonb(p)-array['address','latitude','longitude']) is distinct from b.payload)
    then raise exception 'Unrelated public listing fields changed'; end if;
  if exists(select 1 from public.listings l full join location_private_before b using(id)
    where md5(to_jsonb(l)::text) is distinct from b.digest)
    then raise exception 'Private listing data changed'; end if;
end $$;
notify pgrst,'reload schema';
commit;

-- ==================== region_privacy.sql ====================
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

-- ==================== region_options.sql ====================
-- Extend the saved region allowlist. Existing records and access policies are unchanged.
set local lock_timeout='5s';
alter table public.listings drop constraint listings_region_check;
alter table public.listings add constraint listings_region_check
  check (region in ('北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城'));

create or replace function private.infer_listing_region(t text)
returns text language sql immutable security invoker set search_path='' as $$
 select case when count(*)=1 then min(region) end from
 (values ('北部','北部'),('中部','中部'),('南部','南部'),('生态园','生态园'),('大朗','大朗'),('寮步','寮步'),('大岭山','大岭山'),('东城','东城'),('南城','南城')) r(region,term)
 where coalesce(t,'') like '%'||term||'%';
$$;
revoke all on function private.infer_listing_region(text) from public,anon,authenticated;

-- District names are broad public areas, just like the existing seven regions.
do $$
declare definition text:=pg_get_functiondef('private.redact_listing_text(text,text,text,text)'::regprocedure);
begin
 if strpos(definition,'''大岭山'',''松山湖北部''')=0 then
   raise exception 'Unexpected redaction function; review before updating';
 end if;
 execute replace(definition,'''大岭山'',''松山湖北部''','''大岭山'',''东城'',''南城'',''松山湖北部''');
end $$;
notify pgrst,'reload schema';

-- ==================== listing_owner_contacts.sql ====================
-- Apply after the existing listing fields and region/location privacy upgrades.
-- Additive only: never reclassify or copy historical contacts.
begin;
alter table public.listings
  add column if not exists owner_contact_name text,
  add column if not exists owner_contact_phone text;
comment on column public.listings.owner_contact_name is '业主或园区房源联系人姓名，仅获授权的后台管理员可见；不得加入公开视图。';
comment on column public.listings.owner_contact_phone is '业主或园区房源联系人电话，仅获授权的后台管理员可见；不得加入公开视图。';
revoke select (owner_contact_name, owner_contact_phone) on public.listings from anon, public;
-- Keep existing administrator RLS policies and the public whitelist view unchanged.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.listings'::regclass) then
    raise exception 'listings RLS must be enabled';
  end if;
  if has_table_privilege('anon','public.listings','SELECT')
     or has_column_privilege('anon','public.listings','owner_contact_name','SELECT')
     or has_column_privilege('anon','public.listings','owner_contact_phone','SELECT') then
    raise exception 'Anonymous base-table access must remain denied';
  end if;
  if exists (select 1 from pg_attribute where attrelid='public.public_listings'::regclass
    and attnum>0 and not attisdropped and attname in ('owner_contact_name','owner_contact_phone')) then
    raise exception 'Private owner contacts must not be projected publicly';
  end if;
end $$;
notify pgrst, 'reload schema';
commit;

-- ==================== public_listing_codes.sql ====================
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

-- ==================== customer_profiles.sql ====================
-- Guest registration, NOT customer authentication. Never identify by phone.
create schema if not exists private;
create table private.site_customer_profiles (
  id bigint generated always as identity primary key,
  receipt_hash bytea not null unique,
  nickname text not null,
  phone text not null,
  avatar text not null default '',
  consent_version text not null default 'customer-profile-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.site_customer_profiles enable row level security;
revoke all on private.site_customer_profiles from public, anon, authenticated;
create index site_customer_profiles_created_idx on private.site_customer_profiles(created_at);
create index site_customer_profiles_phone_created_idx on private.site_customer_profiles(phone,created_at);

create function private.save_site_customer_profile(p_receipt text,p_nickname text,p_phone text,p_avatar text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r private.site_customer_profiles;
  receipt bytea;
  image bytea;
  nick text := pg_catalog.btrim(p_nickname);
begin
  if p_consent is distinct from true then raise exception '请先同意保存资料并由招商顾问联系。'; end if;
  if p_receipt is null or p_receipt !~ '^[a-f0-9]{64}$' then raise exception '本机保存凭据无效，请刷新后重试。'; end if;
  if nick is null or pg_catalog.length(nick) not between 1 and 40 or nick ~ '[[:cntrl:]]' then raise exception '称呼请填写 1～40 个字。'; end if;
  if p_phone is null or p_phone !~ '^1[3-9][0-9]{9}$' then raise exception '请填写正确的手机号。'; end if;
  if p_avatar is null or pg_catalog.length(p_avatar)>44000 then raise exception '头像过大，请重新选择图片。'; end if;
  if p_avatar<>'' then
    if p_avatar !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then raise exception '头像格式不支持，请重新选择图片。'; end if;
    image := pg_catalog.decode(pg_catalog.substr(p_avatar,24),'base64');
    if pg_catalog.octet_length(image) not between 100 and 32768
      or pg_catalog.encode(pg_catalog.substr(image,1,3),'hex')<>'ffd8ff'
      or pg_catalog.encode(pg_catalog.substr(image,pg_catalog.octet_length(image)-1,2),'hex')<>'ffd9'
      then raise exception '头像格式不支持，请重新选择图片。'; end if;
  end if;
  receipt := pg_catalog.sha256(pg_catalog.convert_to(p_receipt,'UTF8'));
  -- Serialize the bounded intake check and create, so concurrent retries reuse one ID.
  perform pg_catalog.pg_advisory_xact_lock(281028001);
  select * into r from private.site_customer_profiles where receipt_hash=receipt;
  if found then
    if r.nickname=nick and r.phone=p_phone and r.avatar=p_avatar then
      return pg_catalog.jsonb_build_object('code','KH'||pg_catalog.lpad(r.id::text,8,'0'),'created_at',r.created_at,'updated_at',r.updated_at);
    end if;
    if r.updated_at>pg_catalog.clock_timestamp()-interval '2 seconds' then raise exception '保存太频繁，请稍等片刻重试。'; end if;
    update private.site_customer_profiles set nickname=nick,phone=p_phone,avatar=p_avatar,updated_at=pg_catalog.clock_timestamp() where id=r.id returning * into r;
  else
    if (select count(*) from private.site_customer_profiles where created_at>now()-interval '1 minute')>=60
      or (select count(*) from private.site_customer_profiles where phone=p_phone and created_at>now()-interval '1 hour')>=3 then
      raise exception '当前提交较多，请稍后重试。';
    end if;
    insert into private.site_customer_profiles(receipt_hash,nickname,phone,avatar) values(receipt,nick,p_phone,p_avatar) returning * into r;
  end if;
  return pg_catalog.jsonb_build_object('code','KH'||pg_catalog.lpad(r.id::text,8,'0'),'created_at',r.created_at,'updated_at',r.updated_at);
end $$;

create function public.save_site_customer_profile(p_receipt text,p_nickname text,p_phone text,p_avatar text,p_consent boolean)
returns jsonb language sql security invoker set search_path = '' as $$
 select private.save_site_customer_profile(p_receipt,p_nickname,p_phone,p_avatar,p_consent);
$$;
revoke all on function private.save_site_customer_profile(text,text,text,text,boolean) from public;
revoke all on function public.save_site_customer_profile(text,text,text,text,boolean) from public;
grant usage on schema private to anon,authenticated;
grant execute on function private.save_site_customer_profile(text,text,text,text,boolean) to anon,authenticated;
grant execute on function public.save_site_customer_profile(text,text,text,text,boolean) to anon,authenticated;

create function private.site_admin_customer_profiles(p_page integer,p_page_size integer,p_snapshot bigint,p_avatars boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; boundary bigint; total bigint;
begin
  if auth.uid() is null or not public.can_manage_all_parks() then raise exception '仅全园区管理员可查看客户登记资料。' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>100000 or p_page_size is null or p_page_size not between 1 and 200 then raise exception '分页参数无效。'; end if;
  select coalesce(p_snapshot,max(id),0) into boundary from private.site_customer_profiles;
  select count(*) into total from private.site_customer_profiles where id<=boundary;
  select coalesce(jsonb_agg(row order by id desc),'[]'::jsonb) into result from (
    select id,pg_catalog.jsonb_build_object('code','KH'||pg_catalog.lpad(id::text,8,'0'),'nickname',nickname,'phone',phone,
      'avatar',case when p_avatars then avatar else '' end,'has_avatar',avatar<>'','created_at',created_at,'updated_at',updated_at) as row
    from private.site_customer_profiles where id<=boundary order by id desc limit p_page_size offset p_page::bigint*p_page_size
  ) s;
  return pg_catalog.jsonb_build_object('rows',result,'total',total,'snapshot',boundary);
end $$;
create function public.site_admin_customer_profiles(p_page integer default 0,p_page_size integer default 20,p_snapshot bigint default null,p_avatars boolean default true)
returns jsonb language sql security invoker set search_path = '' as $$
 select private.site_admin_customer_profiles(p_page,p_page_size,p_snapshot,p_avatars);
$$;
revoke all on function private.site_admin_customer_profiles(integer,integer,bigint,boolean) from public,anon;
revoke all on function public.site_admin_customer_profiles(integer,integer,bigint,boolean) from public,anon;
grant execute on function private.site_admin_customer_profiles(integer,integer,bigint,boolean) to authenticated;
grant execute on function public.site_admin_customer_profiles(integer,integer,bigint,boolean) to authenticated;
notify pgrst,'reload schema';

-- ==================== ai_search.sql ====================
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

-- ==================== visitor_analytics.sql ====================
-- Read existing anonymous events; no new tracking or contact/visitor association.
-- Keep privileged reads private, with an explicit active-admin check and park scope.
create index if not exists site_events_visitor_history on public.site_events(visitor_id,created_at desc,id desc) where kind='listing_view';
create or replace function private.site_admin_visit_details(p_visitor uuid default null,p_page integer default 0,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; all_parks boolean; page_no integer; page_size integer;
begin
 if auth.uid() is null or not coalesce(public.is_site_admin(),false) then
   raise exception '请先登录管理后台' using errcode='42501';
 end if;
 if coalesce(p_page,0)<0 or coalesce(p_page,0)>1000000 then raise exception '访问记录页码不正确'; end if;
 page_no:=coalesce(p_page,0);
 page_size:=greatest(1,least(coalesce(p_page_size,20),100));
 all_parks:=coalesce(public.can_manage_all_parks(),false);
 if p_visitor is null then
   with scoped as (
     select e.* from public.site_events e where all_parks or exists(
       select 1 from public.listings l where l.id=e.listing_id and public.can_manage_park(l.park)
     )
   ), visitors as (
     select visitor_id,min(created_at) as first_seen,max(created_at) as last_seen,
       count(distinct session_id) as sessions,count(*) filter(where kind='listing_view') as views
     from scoped group by visitor_id
   ), page_rows as (
     select * from visitors order by last_seen desc,visitor_id limit page_size offset page_no*page_size
   )
   select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by last_seen desc,visitor_id) from page_rows p),'[]'::jsonb),
     'total',(select count(*) from visitors),'page',page_no,'page_size',page_size) into result;
 else
   with scoped as (
     select e.id,e.listing_id,l.title,l.internal_code as listing_code,e.created_at
     from public.site_events e left join public.listings l on l.id=e.listing_id
     where e.visitor_id=p_visitor and e.kind='listing_view'
       and (all_parks or (l.id is not null and public.can_manage_park(l.park)))
   ), page_rows as (
     select * from scoped order by created_at desc,id desc limit page_size offset page_no*page_size
   )
   select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by created_at desc,id desc) from page_rows p),'[]'::jsonb),
     'total',(select count(*) from scoped),'page',page_no,'page_size',page_size) into result;
 end if;
 return result;
end $$;
revoke all on function private.site_admin_visit_details(uuid,integer,integer) from public,anon;
grant execute on function private.site_admin_visit_details(uuid,integer,integer) to authenticated;

create or replace function public.site_admin_visit_details(p_visitor uuid default null,p_page integer default 0,p_page_size integer default 20)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.site_admin_visit_details(p_visitor,p_page,p_page_size);
$$;
revoke all on function public.site_admin_visit_details(uuid,integer,integer) from public,anon;
grant execute on function public.site_admin_visit_details(uuid,integer,integer) to authenticated;
notify pgrst,'reload schema';

-- ==================== visitor_export.sql ====================
-- Export the same anonymous events already visible in the admin, with a fixed
-- upper event ID. No new tracking fields, public table reads, or identity links.
create function private.site_admin_visit_export(p_kind text,p_page integer,p_page_size integer,p_snapshot bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; all_parks boolean; boundary bigint; size integer;
begin
  if auth.uid() is null or not coalesce(public.is_site_admin(),false) then
    raise exception '请先登录管理后台' using errcode='42501';
  end if;
  if p_kind is null or p_kind not in ('summary','views') then raise exception '导出类型不正确'; end if;
  if p_page is null or p_page<0 or p_page>1000000 or p_page_size is null or p_page_size<1 then raise exception '导出页码不正确'; end if;
  if p_snapshot is not null and p_snapshot<0 then raise exception '导出范围不正确'; end if;
  size:=least(p_page_size,500);
  all_parks:=coalesce(public.can_manage_all_parks(),false);
  select coalesce(p_snapshot,max(e.id),0) into boundary from public.site_events e
    where all_parks or exists(select 1 from public.listings l where l.id=e.listing_id and public.can_manage_park(l.park));
  if p_kind='summary' then
    with scoped as (
      select e.* from public.site_events e where e.id<=boundary and
        (all_parks or exists(select 1 from public.listings l where l.id=e.listing_id and public.can_manage_park(l.park)))
    ), visitors as (
      select visitor_id,min(created_at) as first_seen,max(created_at) as last_seen,
        count(distinct session_id) as sessions,count(*) filter(where kind='listing_view') as views
      from scoped group by visitor_id
    ), page_rows as (
      select * from visitors order by visitor_id limit size offset p_page::bigint*size
    )
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by visitor_id) from page_rows p),'[]'::jsonb),
      'total',(select count(*) from visitors),'snapshot',boundary,'page',p_page,'page_size',size) into result;
  else
    with scoped as (
      select e.id,e.visitor_id,e.listing_id,l.title,l.internal_code as listing_code,e.created_at
      from public.site_events e left join public.listings l on l.id=e.listing_id
      where e.id<=boundary and e.kind='listing_view' and (all_parks or (l.id is not null and public.can_manage_park(l.park)))
    ), page_rows as (
      select * from scoped order by id limit size offset p_page::bigint*size
    )
    select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by id) from page_rows p),'[]'::jsonb),
      'total',(select count(*) from scoped),'snapshot',boundary,'page',p_page,'page_size',size) into result;
  end if;
  return result;
end $$;
revoke all on function private.site_admin_visit_export(text,integer,integer,bigint) from public,anon;
grant execute on function private.site_admin_visit_export(text,integer,integer,bigint) to authenticated;
create function public.site_admin_visit_export(p_kind text,p_page integer default 0,p_page_size integer default 500,p_snapshot bigint default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.site_admin_visit_export(p_kind,p_page,p_page_size,p_snapshot);
$$;
revoke all on function public.site_admin_visit_export(text,integer,integer,bigint) from public,anon;
grant execute on function public.site_admin_visit_export(text,integer,integer,bigint) to authenticated;
notify pgrst,'reload schema';
