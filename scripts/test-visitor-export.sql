begin;
do $$
declare actor uuid; a jsonb; b jsonb; snap bigint; expected bigint; park_name text; row jsonb;
begin
  if has_function_privilege('anon','public.site_admin_visit_export(text,integer,integer,bigint)','EXECUTE')
    or has_function_privilege('anon','private.site_admin_visit_export(text,integer,integer,bigint)','EXECUTE')
    or has_table_privilege('authenticated','public.site_events','SELECT') then raise exception 'Public access expanded'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.site_admin_visit_export('summary');raise exception 'No identity accepted';exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin perform public.site_admin_visit_export('summary');raise exception 'Non-admin accepted';exception when insufficient_privilege then null;end;
  select user_id into actor from public.admin_users where active and role='superadmin' limit 1;
  if actor is null then raise exception 'No test administrator';end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  a:=public.site_admin_visit_export('summary',0,1,null);snap:=(a->>'snapshot')::bigint;
  select count(distinct visitor_id) into expected from public.site_events where id<=snap;
  if (a->>'total')::bigint<>expected or jsonb_array_length(a->'rows')>1 then raise exception 'Summary count mismatch';end if;
  b:=public.site_admin_visit_export('summary',1,1,snap);
  if exists(select 1 from jsonb_array_elements(a->'rows') x join jsonb_array_elements(b->'rows') y on x->>'visitor_id'=y->>'visitor_id') then raise exception 'Repeated summary page';end if;
  insert into public.site_events(visitor_id,session_id,kind) values(gen_random_uuid(),gen_random_uuid(),'visit');
  b:=public.site_admin_visit_export('summary',0,500,snap);
  if (b->>'total')::bigint<>expected then raise exception 'Export boundary changed after new visit';end if;
  a:=public.site_admin_visit_export('views',0,500,snap);
  select count(*) into expected from public.site_events where id<=snap and kind='listing_view';
  if (a->>'total')::bigint<>expected then raise exception 'View count mismatch';end if;
  for row in select * from jsonb_array_elements(a->'rows') loop
    if row-array['id','visitor_id','listing_id','title','listing_code','created_at']<>'{}'::jsonb then raise exception 'Unexpected export fields';end if;
  end loop;
  if (public.site_admin_visit_export('views',0,10000,snap)->>'page_size')::integer<>500 then raise exception 'Unbounded page';end if;
  begin perform public.site_admin_visit_export('invalid');raise exception 'Invalid kind accepted';exception when raise_exception then if sqlerrm<>'导出类型不正确' then raise;end if;end;
  select park into park_name from public.listings where park is not null limit 1;
  if park_name is not null then
    update public.admin_users set role='park_admin',park=park_name where user_id=actor;
    a:=public.site_admin_visit_export('views',0,500,null);
    select count(*) into expected from public.site_events e join public.listings l on l.id=e.listing_id where l.park=park_name and e.kind='listing_view';
    if (a->>'total')::bigint<>expected then raise exception 'Park export scope mismatch';end if;
    for row in select * from jsonb_array_elements(a->'rows') loop
      if not exists(select 1 from public.listings where id=(row->>'listing_id')::uuid and park=park_name) then raise exception 'Other park exported';end if;
    end loop;
    a:=public.site_admin_visit_export('summary',0,500,null);
    select count(distinct e.visitor_id) into expected from public.site_events e join public.listings l on l.id=e.listing_id where l.park=park_name;
    if (a->>'total')::bigint<>expected then raise exception 'Park summary scope mismatch';end if;
    update public.admin_users set active=false where user_id=actor;
    begin perform public.site_admin_visit_export('views');raise exception 'Inactive admin accepted';exception when insufficient_privilege then null;end;
  end if;
end $$;
rollback;
select 'PASS: admin-only; exact summary/detail counts; snapshot excludes new events; bounded pagination; field whitelist; park isolation; inactive account denied; all test changes rolled back' as result;
