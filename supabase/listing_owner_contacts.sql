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
