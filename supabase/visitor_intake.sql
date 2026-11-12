-- Unified visitor intake. Additive; keeps all existing records.
begin;
alter table public.inquiries add column if not exists kind text not null default 'inquiry' check(kind in ('inquiry','company','need'));
alter table public.inquiries add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.inquiries add column if not exists client_request_id uuid;
create index if not exists inquiries_phone_time on public.inquiries(phone,created_at);
create unique index if not exists inquiries_request_id_unique on public.inquiries(client_request_id) where client_request_id is not null;

create or replace function public.submit_site_inquiry(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r inquiries; lid uuid; rid uuid; k text; ph text; co text; who text; msg text; d jsonb; raw_d jsonb; v_at timestamptz;
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>16000 then raise exception '提交内容格式不正确或过长'; end if;
 k:=coalesce(p_payload->>'kind','inquiry');
 if k not in ('inquiry','company','need') then raise exception '不支持的提交类型'; end if;
 if coalesce((p_payload->>'consent')::boolean,false) is not true then raise exception '请确认同意用于本次招商联系'; end if;
 rid:=nullif(p_payload->>'client_request_id','')::uuid;
 if rid is null then raise exception '请刷新网页后重新提交'; end if;
 ph:=trim(coalesce(p_payload->>'phone','')); who:=trim(coalesce(p_payload->>'contact',''));
 co:=trim(coalesce(p_payload->>'company','')); msg:=trim(coalesce(p_payload->>'request_text',''));
 if length(who) not between 1 and 40 or ph !~ '^1[3-9][0-9]{9}$' or length(co) not between 1 and 80 or length(msg) not between 4 and 4000 then raise exception '请检查称呼、手机号、企业名称和内容长度'; end if;
 if coalesce(p_payload->>'website','')<>'' then raise exception '提交未完成，请稍后重试'; end if;
 -- Serialize rate limit and idempotency decisions; no client-supplied identity grants access.
 perform pg_advisory_xact_lock(20261019,3);
 select * into r from inquiries where client_request_id=rid;
 if found then
  if r.phone=ph and r.kind=k and r.company=co and r.contact=who and r.request_text=msg and r.details=coalesce(p_payload->'details','{}'::jsonb) then
   return jsonb_build_object('id',r.id,'receipt',r.receipt);
  end if;
  raise exception '提交标识已使用，请重新打开表单';
 end if;
 if (select count(*) from inquiries where phone=ph and created_at>now()-interval '1 hour')>=10
 or exists(select 1 from inquiries where phone=ph and created_at>now()-interval '10 seconds') then raise exception '提交过于频繁，请稍后再试'; end if;
 if (select count(*) from inquiries where created_at>now()-interval '1 minute')>=120 then raise exception '当前提交较多，请一分钟后重试'; end if;
 lid:=nullif(p_payload->>'listing_id','')::uuid;
 if lid is not null and (k<>'inquiry' or not exists(select 1 from listings where id=lid and status='published' and deleted_at is null)) then raise exception '该房源当前不可咨询'; end if;
 raw_d:=coalesce(p_payload->'details','{}'::jsonb);
 if jsonb_typeof(raw_d) is distinct from 'object' then raise exception '资料格式不正确'; end if;
 if k='company' then
  if length(trim(coalesce(raw_d->>'name',''))) not between 1 and 80 or raw_d->>'name'<>co
  or length(coalesce(raw_d->>'industry',''))>60 or length(coalesce(raw_d->>'product',''))>200 or length(coalesce(raw_d->>'intro',''))>500 then raise exception '请检查企业资料长度'; end if;
  d:=jsonb_build_object('name',co,'industry',coalesce(raw_d->>'industry',''),'product',coalesce(raw_d->>'product',''),'intro',coalesce(raw_d->>'intro',''));
 elsif k='need' then
  if length(trim(coalesce(raw_d->>'type',''))) not between 1 and 40 or length(trim(coalesce(raw_d->>'description',''))) not between 4 and 300 then raise exception '需求描述须为4至300字'; end if;
  d:=jsonb_build_object('type',raw_d->>'type','description',trim(raw_d->>'description'));
 else d:='{}'::jsonb; end if;
 v_at:=nullif(p_payload->>'viewing_at','')::timestamptz;
 if v_at is not null and (v_at<now()-interval '1 hour' or v_at>now()+interval '1 year') then raise exception '请填写未来一年内的看房时间'; end if;
 insert into inquiries(listing_id,company,contact,phone,request_text,viewing_at,receipt,kind,details,client_request_id)
 values(lid,co,who,ph,msg,v_at,gen_random_uuid(),k,d,rid) returning * into r;
 return jsonb_build_object('id',r.id,'receipt',r.receipt);
end; $$;
revoke all on function public.submit_site_inquiry(jsonb) from public;
grant execute on function public.submit_site_inquiry(jsonb) to anon,authenticated;
-- Close the old direct insert path; server-generated status/reply/receipt cannot be supplied by visitors.
drop policy if exists "visitors can submit inquiry" on public.inquiries;
revoke insert,update,delete on public.inquiries from anon,authenticated;
notify pgrst,'reload schema';
commit;
