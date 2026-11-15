-- 楼栋管理员：给每栋楼指定负责人，并把后台权限限制在自己负责的楼栋
-- 用法：Supabase 控制台 → SQL Editor → 整段粘贴执行；可重复执行。
-- 依赖：buildings.sql、admin_all_parks.sql 已经执行过。
begin;
set local lock_timeout = '5s';

-- ==================== 1. 新增角色与关联字段 ====================
-- 楼栋管理员：没有园区范围，只管理 buildings.manager_id 指向自己的楼栋。
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users drop constraint if exists admin_users_check;
alter table public.admin_users add constraint admin_users_role_check
  check (role in ('superadmin', 'content_admin', 'park_admin', 'building_admin'));
alter table public.admin_users add constraint admin_users_check
  check (
    (role in ('superadmin', 'content_admin', 'building_admin') and park is null)
    or (role = 'park_admin' and park is not null)
  );

-- 每栋楼一位负责人。同一个人可以负责多栋楼，但一栋楼只认一个负责人。
alter table public.buildings
  add column if not exists manager_id uuid references auth.users(id) on delete set null;
comment on column public.buildings.manager_id is
  '楼栋负责人（building_admin）；只有超级管理员能调整，负责人只能维护这栋楼的数据';
create index if not exists buildings_manager_idx on public.buildings (manager_id);

-- 企业用稳定的 building_id 关联楼栋，避免只靠名称匹配时改名或空格差异导致漏匹配。
alter table public.companies
  add column if not exists building_id uuid references public.buildings(id) on delete set null;
comment on column public.companies.building_id is
  '企业所在楼栋（稳定关联）；为空时前台回退到按楼栋名称匹配';
create index if not exists companies_building_idx on public.companies (building_id);

-- 已有企业：楼栋名称和楼栋表完全一致时自动补上关联。
update public.companies c
set building_id = b.id
from public.buildings b
where c.building_id is null
  and c.building is not null
  and lower(btrim(c.building)) = lower(btrim(b.name));

-- ==================== 2. 权限判断函数 ====================
-- 超级管理员、全园区管理员：全部楼栋
-- 楼栋管理员：只有 manager_id = 自己的楼栋
-- 园区管理员：所属片区（region）与本园区一致的楼栋
create or replace function public.can_manage_building(target_building uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.admin_users a
    where a.user_id = auth.uid()
      and a.active
      and (
        a.role in ('superadmin', 'content_admin')
        or (a.role = 'building_admin' and exists(
          select 1 from public.buildings b
          where b.id = target_building and b.manager_id = a.user_id
        ))
        or (a.role = 'park_admin' and exists(
          select 1 from public.buildings b
          where b.id = target_building and b.region = a.park
        ))
      )
  );
$$;
revoke all on function public.can_manage_building(uuid) from public;
grant execute on function public.can_manage_building(uuid) to authenticated;

-- 企业权限：园区管理员按园区；楼栋管理员按企业所属楼栋。
create or replace function public.can_manage_company(target_park text, target_building uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_park(target_park)
    or (target_building is not null and public.can_manage_building(target_building));
$$;
revoke all on function public.can_manage_company(text, uuid) from public;
grant execute on function public.can_manage_company(text, uuid) to authenticated;

-- 只有超级管理员能改楼栋负责人，防止楼栋管理员把权限转给别人。
create or replace function private.protect_building_manager()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.manager_id is distinct from old.manager_id and not public.is_superadmin() then
    raise exception '只有超级管理员可以调整楼栋负责人';
  end if;
  return new;
end $$;
revoke all on function private.protect_building_manager() from public, anon, authenticated;

drop trigger if exists protect_building_manager on public.buildings;
create trigger protect_building_manager before update on public.buildings
  for each row execute function private.protect_building_manager();

-- ==================== 3. 楼栋与单元权限 ====================
drop policy if exists "admins read buildings" on public.buildings;
drop policy if exists "admins insert buildings" on public.buildings;
drop policy if exists "admins update buildings" on public.buildings;
drop policy if exists "admins delete buildings" on public.buildings;
drop policy if exists "admins read scoped buildings" on public.buildings;
drop policy if exists "admins insert scoped buildings" on public.buildings;
drop policy if exists "admins update scoped buildings" on public.buildings;
drop policy if exists "admins delete scoped buildings" on public.buildings;

create policy "admins read scoped buildings" on public.buildings
  for select to authenticated using (public.can_manage_building(id));

-- 新增楼栋仍然只给超级管理员和全园区管理员，楼栋管理员不能自己造楼。
create policy "admins insert scoped buildings" on public.buildings
  for insert to authenticated with check (public.can_manage_all_parks());

create policy "admins update scoped buildings" on public.buildings
  for update to authenticated
  using (public.can_manage_building(id)) with check (public.can_manage_building(id));

-- 删除整栋楼会连带删掉空置单元，只允许超级管理员和全园区管理员操作。
create policy "admins delete scoped buildings" on public.buildings
  for delete to authenticated using (public.can_manage_all_parks());

drop policy if exists "admins read building units" on public.building_units;
drop policy if exists "admins insert building units" on public.building_units;
drop policy if exists "admins update building units" on public.building_units;
drop policy if exists "admins delete building units" on public.building_units;
drop policy if exists "admins read scoped building units" on public.building_units;
drop policy if exists "admins insert scoped building units" on public.building_units;
drop policy if exists "admins update scoped building units" on public.building_units;
drop policy if exists "admins delete scoped building units" on public.building_units;

create policy "admins read scoped building units" on public.building_units
  for select to authenticated using (public.can_manage_building(building_id));
create policy "admins insert scoped building units" on public.building_units
  for insert to authenticated with check (public.can_manage_building(building_id));
create policy "admins update scoped building units" on public.building_units
  for update to authenticated
  using (public.can_manage_building(building_id)) with check (public.can_manage_building(building_id));
create policy "admins delete scoped building units" on public.building_units
  for delete to authenticated using (public.can_manage_building(building_id));

-- ==================== 4. 企业权限 ====================
drop policy if exists "admins read own park companies" on public.companies;
drop policy if exists "admins insert own park companies" on public.companies;
drop policy if exists "admins update own park companies" on public.companies;
drop policy if exists "admins delete own park companies" on public.companies;
drop policy if exists "admins read scoped companies" on public.companies;
drop policy if exists "admins insert scoped companies" on public.companies;
drop policy if exists "admins update scoped companies" on public.companies;
drop policy if exists "admins delete scoped companies" on public.companies;

create policy "admins read scoped companies" on public.companies
  for select to authenticated using (public.can_manage_company(park, building_id));
create policy "admins insert scoped companies" on public.companies
  for insert to authenticated with check (public.can_manage_company(park, building_id));
create policy "admins update scoped companies" on public.companies
  for update to authenticated
  using (public.can_manage_company(park, building_id))
  with check (public.can_manage_company(park, building_id));
create policy "admins delete scoped companies" on public.companies
  for delete to authenticated using (public.can_manage_company(park, building_id));

-- ==================== 5. 账号管理支持楼栋管理员 ====================
-- 新增 p_role 参数；旧的 6 参数签名先删除，避免 PostgREST 出现重载歧义。
drop function if exists public.manage_site_admin(text, text, uuid, text, text, boolean);

create or replace function public.manage_site_admin(
  p_action text,
  p_email text default null,
  p_user uuid default null,
  p_name text default '',
  p_park text default null,
  p_active boolean default true,
  p_role text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  target uuid;
  a admin_users;
  lim integer;
  all_parks boolean := coalesce(p_park = '__all_parks__', false);
  building_scope boolean := coalesce(p_park = '__buildings__', false) or coalesce(p_role = 'building_admin', false);
  wanted_role text;
begin
  if not public.is_superadmin() then raise exception '仅超级管理员可管理账号'; end if;
  perform pg_advisory_xact_lock(20261019, 2);

  wanted_role := case
    when all_parks or p_role = 'content_admin' then 'content_admin'
    when building_scope then 'building_admin'
    else 'park_admin'
  end;
  target := p_user;

  if p_action = 'add' then
    select id into target from auth.users where lower(email) = lower(trim(p_email));
    if target is null then raise exception '该邮箱尚未创建登录账号，请先使用新增账号功能'; end if;
    if exists(select 1 from admin_users where user_id = target) then raise exception '该账号已在管理员列表中'; end if;
    select admin_limit into lim from site_settings where id;
    if (select count(*) from admin_users) >= lim then raise exception '管理员数量已达上限'; end if;
    if wanted_role = 'park_admin' and not exists(select 1 from parks where name = p_park and active) then
      raise exception '请选择一个启用的园区';
    end if;
    insert into admin_users(user_id, role, park, active, display_name)
    values (
      target,
      wanted_role,
      case when wanted_role = 'park_admin' then p_park else null end,
      true,
      left(trim(p_name), 60)
    );
  elsif p_action in ('update', 'remove') then
    select * into a from admin_users where user_id = target for update;
    if not found then raise exception '管理员不存在'; end if;
    if a.role = 'superadmin' then
      if p_action = 'remove' or not p_active then raise exception '不能移除或停用超级管理员'; end if;
      update admin_users set display_name = left(trim(p_name), 60) where user_id = target;
    elsif p_action = 'remove' then
      delete from admin_users where user_id = target;
      update public.buildings set manager_id = null where manager_id = target;
    else
      if wanted_role = 'park_admin' and not exists(select 1 from parks where name = p_park and active) then
        raise exception '请选择一个启用的园区';
      end if;
      update admin_users
      set display_name = left(trim(p_name), 60),
          role = wanted_role,
          park = case when wanted_role = 'park_admin' then p_park else null end,
          active = p_active
      where user_id = target;
      -- 不再担任楼栋管理员时，清掉负责关系，避免留下无人认领的楼栋。
      if wanted_role <> 'building_admin' then
        update public.buildings set manager_id = null where manager_id = target;
      end if;
    end if;
  else
    raise exception '不支持的账号操作';
  end if;

  return target;
end $$;
revoke all on function public.manage_site_admin(text, text, uuid, text, text, boolean, text) from public;
grant execute on function public.manage_site_admin(text, text, uuid, text, text, boolean, text) to authenticated;

-- ==================== 6. 公开视图补充楼栋关联 ====================
-- CREATE OR REPLACE VIEW 只允许在末尾追加列，所以 building_id 放在 floor 后面。
create or replace view public.public_companies with (security_barrier = true) as
select
  c.id,
  c.name,
  c.park,
  c.building,
  c.room,
  c.industry,
  c.status,
  c.established_on,
  extract(year from c.established_on)::int as established_year,
  c.registered_capital,
  coalesce(
    nullif(btrim(c.employee_band), ''),
    case
      when c.social_insurance_count is null then null
      when c.social_insurance_count < 10 then '10人以内'
      when c.social_insurance_count < 50 then '10-50人'
      when c.social_insurance_count < 100 then '50-100人'
      when c.social_insurance_count < 500 then '100-500人'
      else '500人以上'
    end
  ) as employee_band,
  case
    when c.legal_representative is null or btrim(c.legal_representative) = '' then null
    else left(btrim(c.legal_representative), 1) || '**'
  end as legal_representative,
  case
    when c.phone is null then null
    when length(regexp_replace(c.phone, '\D', '', 'g')) >= 7
      then left(regexp_replace(c.phone, '\D', '', 'g'), 3) || '****'
           || right(regexp_replace(c.phone, '\D', '', 'g'), 4)
    else '***'
  end as phone,
  case
    when c.email is null or position('@' in c.email) < 2 then null
    else left(split_part(c.email, '@', 1), 1) || '***@' || split_part(c.email, '@', 2)
  end as email,
  case
    when c.unified_code is null or length(btrim(c.unified_code)) <= 8 then null
    else left(btrim(c.unified_code), 8) || '****'
  end as unified_code,
  c.address,
  c.business_scope,
  c.website,
  c.tags,
  c.updated_at,
  c.floor,
  c.building_id
from public.companies c
where c.published;

revoke all on table public.public_companies from public, anon, authenticated;
grant select on table public.public_companies to anon, authenticated;

commit;
