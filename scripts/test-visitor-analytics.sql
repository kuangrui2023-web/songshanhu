-- Run with database maintenance access. Role changes are uncommitted and rolled back.
begin;
do $$
declare actor uuid; result jsonb; second_page jsonb; history jsonb; vid uuid; park_name text; expected bigint; row jsonb;
begin
 if has_function_privilege('anon','public.site_admin_visit_details(uuid,integer,integer)','EXECUTE')
   or has_function_privilege('anon','private.site_admin_visit_details(uuid,integer,integer)','EXECUTE')
   or has_table_privilege('anon','public.site_events','SELECT')
   or has_table_privilege('authenticated','public.site_events','SELECT') then raise exception 'Anonymous or direct table access expanded'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
   perform public.site_admin_visit_details();
   raise exception 'Missing identity was accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
   perform public.site_admin_visit_details();
   raise exception 'Non-admin identity was accepted';
 exception when insufficient_privilege then null; end;
 select user_id into actor from public.admin_users where role='superadmin' and active limit 1;
 if actor is null then raise exception 'No authorized test administrator'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 result:=public.site_admin_visit_details(null,0,20);
 select count(distinct visitor_id) into expected from public.site_events;
 if (result->>'total')::bigint<>expected or jsonb_array_length(result->'rows')>20 then raise exception 'Visitor totals/pagination failed'; end if;
 second_page:=public.site_admin_visit_details(null,1,20);
 if exists(select 1 from jsonb_array_elements(result->'rows') a join jsonb_array_elements(second_page->'rows') b on a->>'visitor_id'=b->>'visitor_id') then raise exception 'Duplicate visitor across pages'; end if;
 if (public.site_admin_visit_details(null,0,1000)->>'page_size')::integer<>100 then raise exception 'Page-size cap failed'; end if;
 begin
   perform public.site_admin_visit_details(null,-1,20);
   raise exception 'Invalid page accepted';
 exception when raise_exception then if sqlerrm<>'访问记录页码不正确' then raise; end if; end;
 select visitor_id into vid from public.site_events where kind='listing_view' limit 1;
 if vid is not null then
   history:=public.site_admin_visit_details(vid,0,20);
   select count(*) into expected from public.site_events where visitor_id=vid and kind='listing_view';
   if (history->>'total')::bigint<>expected then raise exception 'Visitor history mismatch'; end if;
   for row in select * from jsonb_array_elements(history->'rows') loop
     if row-array['id','listing_id','title','listing_code','created_at']<>'{}'::jsonb then raise exception 'Unexpected history fields'; end if;
   end loop;
 end if;
 select l.park into park_name from public.listings l join public.site_events e on e.listing_id=l.id where l.park is not null limit 1;
 if park_name is not null then
   update public.admin_users set role='park_admin',park=park_name where user_id=actor;
   result:=public.site_admin_visit_details(null,0,100);
   select count(distinct e.visitor_id) into expected from public.site_events e join public.listings l on l.id=e.listing_id where l.park=park_name;
   if (result->>'total')::bigint<>expected then raise exception 'Park visitor scope leaked'; end if;
   for row in select * from jsonb_array_elements(result->'rows') loop
     history:=public.site_admin_visit_details((row->>'visitor_id')::uuid,0,100);
     if exists(select 1 from jsonb_array_elements(history->'rows') h left join public.listings l on l.id=(h->>'listing_id')::uuid where l.park is distinct from park_name) then raise exception 'Other park history leaked'; end if;
   end loop;
   update public.admin_users set active=false where user_id=actor;
   begin
     perform public.site_admin_visit_details();
     raise exception 'Inactive administrator accepted';
   exception when insufficient_privilege then null; end;
 end if;
end $$;
rollback;
select 'PASS: admin-only access; bounded pagination; exact history; park isolation; inactive/non-admin denial; test changes rolled back' as result;
