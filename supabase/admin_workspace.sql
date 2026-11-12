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
