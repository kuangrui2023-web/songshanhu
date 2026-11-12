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
