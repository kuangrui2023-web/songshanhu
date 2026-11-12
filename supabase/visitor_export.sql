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
