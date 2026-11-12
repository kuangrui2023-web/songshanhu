-- Extend the saved region allowlist. Existing records and access policies are unchanged.
set local lock_timeout='5s';
alter table public.listings drop constraint listings_region_check;
alter table public.listings add constraint listings_region_check
  check (region in ('北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城'));

create or replace function private.infer_listing_region(t text)
returns text language sql immutable security invoker set search_path='' as $$
 select case when count(*)=1 then min(region) end from
 (values ('北部','北部'),('中部','中部'),('南部','南部'),('生态园','生态园'),('大朗','大朗'),('寮步','寮步'),('大岭山','大岭山'),('东城','东城'),('南城','南城')) r(region,term)
 where coalesce(t,'') like '%'||term||'%';
$$;
revoke all on function private.infer_listing_region(text) from public,anon,authenticated;

-- District names are broad public areas, just like the existing seven regions.
do $$
declare definition text:=pg_get_functiondef('private.redact_listing_text(text,text,text,text)'::regprocedure);
begin
 if strpos(definition,'''大岭山'',''松山湖北部''')=0 then
   raise exception 'Unexpected redaction function; review before updating';
 end if;
 execute replace(definition,'''大岭山'',''松山湖北部''','''大岭山'',''东城'',''南城'',''松山湖北部''');
end $$;
notify pgrst,'reload schema';
