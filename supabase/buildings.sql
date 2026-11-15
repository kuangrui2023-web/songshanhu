-- 楼栋楼层导览：楼栋表 + 空置单元表 + 企业楼层字段 + 公开视图
-- 用法：在 Supabase 控制台 SQL Editor 整段粘贴执行；可重复执行。
-- 依赖：bootstrap.sql 里的 public.is_site_admin()。
begin;
set local lock_timeout = '5s';

-- ==================== 1. 楼栋表（真实值，仅管理员可写） ====================
create table if not exists public.buildings (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  region text check (region is null or length(btrim(region)) <= 120),
  address text check (address is null or length(address) <= 300),
  floors_count integer check (floors_count is null or floors_count between 1 and 200),
  cover_url text check (cover_url is null or length(cover_url) <= 1000),
  description text check (description is null or length(description) <= 4000),
  highlights text[] not null default '{}',
  sort_order integer not null default 0,
  published boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.buildings is '楼栋导览（前台经 public_buildings 视图读取，只展示 published=true 的楼栋）';

create unique index if not exists buildings_name_key
  on public.buildings (lower(btrim(name)));
create index if not exists buildings_published_idx on public.buildings (sort_order, name) where published;

-- ==================== 2. 空置单元表 ====================
create table if not exists public.building_units (
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null references public.buildings(id) on delete cascade,
  floor text not null check (length(btrim(floor)) between 1 and 30),
  floor_no integer,
  room text check (room is null or length(btrim(room)) <= 60),
  area numeric(10,2) check (area is null or area >= 0),
  rent numeric(10,2) check (rent is null or rent >= 0),
  fee numeric(10,2) check (fee is null or fee >= 0),
  orientation text check (orientation is null or length(btrim(orientation)) <= 30),
  decoration text check (decoration is null or length(btrim(decoration)) <= 60),
  status text not null default 'vacant' check (status in ('vacant', 'reserved', 'occupied')),
  note text check (note is null or length(note) <= 1000),
  sort_order integer not null default 0,
  published boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.building_units is '楼栋内的单元/空置房源清单；occupied 单元前台不展示，已入驻企业请写在 companies 表';

create index if not exists building_units_building_idx
  on public.building_units (building_id, floor_no desc, sort_order, room);
create index if not exists building_units_public_idx
  on public.building_units (building_id, floor_no desc) where published and status in ('vacant', 'reserved');

-- ==================== 3. 企业表增加楼层 ====================
alter table public.companies
  add column if not exists floor text check (floor is null or length(btrim(floor)) <= 30);
comment on column public.companies.floor is '所在楼层，例如 12F、12楼、B1；前台楼层导览按此字段归层';

-- ==================== 4. 权限：沿用企业的管理员写法 ====================
alter table public.buildings enable row level security;
revoke all on table public.buildings from anon, authenticated;
grant select, insert, update, delete on table public.buildings to authenticated;

drop policy if exists "admins read buildings" on public.buildings;
create policy "admins read buildings" on public.buildings
  for select to authenticated using (public.is_site_admin());

drop policy if exists "admins insert buildings" on public.buildings;
create policy "admins insert buildings" on public.buildings
  for insert to authenticated with check (public.is_site_admin());

drop policy if exists "admins update buildings" on public.buildings;
create policy "admins update buildings" on public.buildings
  for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "admins delete buildings" on public.buildings;
create policy "admins delete buildings" on public.buildings
  for delete to authenticated using (public.is_site_admin());

alter table public.building_units enable row level security;
revoke all on table public.building_units from anon, authenticated;
grant select, insert, update, delete on table public.building_units to authenticated;

drop policy if exists "admins read building units" on public.building_units;
create policy "admins read building units" on public.building_units
  for select to authenticated using (public.is_site_admin());

drop policy if exists "admins insert building units" on public.building_units;
create policy "admins insert building units" on public.building_units
  for insert to authenticated with check (public.is_site_admin());

drop policy if exists "admins update building units" on public.building_units;
create policy "admins update building units" on public.building_units
  for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "admins delete building units" on public.building_units;
create policy "admins delete building units" on public.building_units
  for delete to authenticated using (public.is_site_admin());

-- updated_at 自动刷新（复用一个触发器函数）
create or replace function private.touch_building_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.touch_building_updated_at() from public, anon, authenticated;

drop trigger if exists touch_building_updated_at on public.buildings;
create trigger touch_building_updated_at before update on public.buildings
  for each row execute function private.touch_building_updated_at();

drop trigger if exists touch_building_unit_updated_at on public.building_units;
create trigger touch_building_unit_updated_at before update on public.building_units
  for each row execute function private.touch_building_updated_at();

-- ==================== 5. 公开视图 ====================
-- 视图由所有者（postgres）执行，绕过 RLS，因此必须在 where 里自己过滤 published。
create or replace view public.public_buildings with (security_barrier = true) as
select
  b.id,
  b.name,
  b.region,
  b.address,
  b.floors_count,
  b.cover_url,
  b.description,
  b.highlights,
  b.sort_order,
  b.updated_at
from public.buildings b
where b.published;

revoke all on table public.public_buildings from public, anon, authenticated;
grant select on table public.public_buildings to anon, authenticated;

create or replace view public.public_building_units with (security_barrier = true) as
select
  u.id,
  u.building_id,
  u.floor,
  u.floor_no,
  u.room,
  u.area,
  u.rent,
  u.fee,
  u.orientation,
  u.decoration,
  u.status,
  u.note,
  u.sort_order,
  u.updated_at
from public.building_units u
join public.buildings b on b.id = u.building_id
where b.published and u.published and u.status in ('vacant', 'reserved');

revoke all on table public.public_building_units from public, anon, authenticated;
grant select on table public.public_building_units to anon, authenticated;

-- 企业公开视图补上楼层。CREATE OR REPLACE VIEW 只允许在末尾追加列，所以 floor 放在最后。
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
  c.floor
from public.companies c
where c.published;

revoke all on table public.public_companies from public, anon, authenticated;
grant select on table public.public_companies to anon, authenticated;

commit;
