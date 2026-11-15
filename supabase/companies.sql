-- 入驻企业名录：企业表 + 分区权限 + 公开打码视图
-- 用法：在 Supabase 控制台 SQL Editor 整段粘贴执行；可重复执行。
-- 依赖：bootstrap.sql 里的 public.can_manage_park(text)。
begin;
set local lock_timeout = '5s';

-- ==================== 1. 企业表（真实值，仅管理员可读写） ====================
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 200),
  park text check (park is null or length(btrim(park)) between 1 and 120),
  building text check (building is null or length(building) <= 60),
  room text check (room is null or length(room) <= 60),
  industry text check (industry is null or length(industry) <= 120),
  status text check (status is null or length(status) <= 40),
  established_on date,
  registered_capital numeric(16,2) check (registered_capital is null or registered_capital >= 0),
  employee_band text check (employee_band is null or length(employee_band) <= 40),
  -- 以下为敏感字段：只在原表存在，公开视图里一律打码
  legal_representative text check (legal_representative is null or length(legal_representative) <= 60),
  social_insurance_count integer check (social_insurance_count is null or social_insurance_count >= 0),
  unified_code text check (unified_code is null or length(unified_code) <= 32),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 120),
  -- 以下为公开字段
  address text check (address is null or length(address) <= 300),
  business_scope text check (business_scope is null or length(business_scope) <= 4000),
  website text check (website is null or length(website) <= 200),
  tags text[] not null default '{}',
  source text check (source is null or length(source) <= 200),
  published boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is '入驻企业名录（含敏感字段，前台只能读 public_companies 视图）';

-- 同园区内企业名称唯一（大小写、首尾空格不敏感）
create unique index if not exists companies_park_name_key
  on public.companies (coalesce(park, ''), lower(btrim(name)));
create index if not exists companies_park_idx on public.companies (park) where published;
create index if not exists companies_industry_idx on public.companies (industry) where published;

-- ==================== 2. 权限：沿用房源表的分区管理员写法 ====================
alter table public.companies enable row level security;
revoke all on table public.companies from anon, authenticated;
grant select, insert, update, delete on table public.companies to authenticated;

drop policy if exists "admins read own park companies" on public.companies;
create policy "admins read own park companies" on public.companies
  for select to authenticated using (public.can_manage_park(park));

drop policy if exists "admins insert own park companies" on public.companies;
create policy "admins insert own park companies" on public.companies
  for insert to authenticated with check (public.can_manage_park(park));

drop policy if exists "admins update own park companies" on public.companies;
create policy "admins update own park companies" on public.companies
  for update to authenticated
  using (public.can_manage_park(park)) with check (public.can_manage_park(park));

drop policy if exists "admins delete own park companies" on public.companies;
create policy "admins delete own park companies" on public.companies
  for delete to authenticated using (public.can_manage_park(park));

-- updated_at 自动刷新
create or replace function private.touch_company_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.touch_company_updated_at() from public, anon, authenticated;

drop trigger if exists touch_company_updated_at on public.companies;
create trigger touch_company_updated_at before update on public.companies
  for each row execute function private.touch_company_updated_at();

-- ==================== 3. 公开视图：在这里打码，而不是在前端 ====================
-- 视图由所有者（postgres）执行，绕过 RLS，因此必须在 where 里自己过滤 published。
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
  -- 人数只对外给区间：优先用人工填写的区间，否则按参保人数换算
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
  -- 法定代表人：保留姓，其余固定打两颗星（不泄露名字长度）
  case
    when c.legal_representative is null or btrim(c.legal_representative) = '' then null
    else left(btrim(c.legal_representative), 1) || '**'
  end as legal_representative,
  -- 联系电话：138****5678
  case
    when c.phone is null then null
    when length(regexp_replace(c.phone, '\D', '', 'g')) >= 7
      then left(regexp_replace(c.phone, '\D', '', 'g'), 3) || '****'
           || right(regexp_replace(c.phone, '\D', '', 'g'), 4)
    else '***'
  end as phone,
  -- 邮箱：a***@qq.com
  case
    when c.email is null or position('@' in c.email) < 2 then null
    else left(split_part(c.email, '@', 1), 1) || '***@' || split_part(c.email, '@', 2)
  end as email,
  -- 统一社会信用代码：前 8 位 + 星号
  case
    when c.unified_code is null or length(btrim(c.unified_code)) <= 8 then null
    else left(btrim(c.unified_code), 8) || '****'
  end as unified_code,
  c.address,
  c.business_scope,
  c.website,
  c.tags,
  c.updated_at
from public.companies c
where c.published;

revoke all on table public.public_companies from public, anon, authenticated;
grant select on table public.public_companies to anon, authenticated;

commit;
