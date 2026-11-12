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
