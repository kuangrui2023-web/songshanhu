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
