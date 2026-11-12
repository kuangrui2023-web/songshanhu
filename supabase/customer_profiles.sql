-- Guest registration, NOT customer authentication. Never identify by phone.
create schema if not exists private;
create table private.site_customer_profiles (
  id bigint generated always as identity primary key,
  receipt_hash bytea not null unique,
  nickname text not null,
  phone text not null,
  avatar text not null default '',
  consent_version text not null default 'customer-profile-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.site_customer_profiles enable row level security;
revoke all on private.site_customer_profiles from public, anon, authenticated;
create index site_customer_profiles_created_idx on private.site_customer_profiles(created_at);
create index site_customer_profiles_phone_created_idx on private.site_customer_profiles(phone,created_at);

create function private.save_site_customer_profile(p_receipt text,p_nickname text,p_phone text,p_avatar text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r private.site_customer_profiles;
  receipt bytea;
  image bytea;
  nick text := pg_catalog.btrim(p_nickname);
begin
  if p_consent is distinct from true then raise exception '请先同意保存资料并由招商顾问联系。'; end if;
  if p_receipt is null or p_receipt !~ '^[a-f0-9]{64}$' then raise exception '本机保存凭据无效，请刷新后重试。'; end if;
  if nick is null or pg_catalog.length(nick) not between 1 and 40 or nick ~ '[[:cntrl:]]' then raise exception '称呼请填写 1～40 个字。'; end if;
  if p_phone is null or p_phone !~ '^1[3-9][0-9]{9}$' then raise exception '请填写正确的手机号。'; end if;
  if p_avatar is null or pg_catalog.length(p_avatar)>44000 then raise exception '头像过大，请重新选择图片。'; end if;
  if p_avatar<>'' then
    if p_avatar !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then raise exception '头像格式不支持，请重新选择图片。'; end if;
    image := pg_catalog.decode(pg_catalog.substr(p_avatar,24),'base64');
    if pg_catalog.octet_length(image) not between 100 and 32768
      or pg_catalog.encode(pg_catalog.substr(image,1,3),'hex')<>'ffd8ff'
      or pg_catalog.encode(pg_catalog.substr(image,pg_catalog.octet_length(image)-1,2),'hex')<>'ffd9'
      then raise exception '头像格式不支持，请重新选择图片。'; end if;
  end if;
  receipt := pg_catalog.sha256(pg_catalog.convert_to(p_receipt,'UTF8'));
  -- Serialize the bounded intake check and create, so concurrent retries reuse one ID.
  perform pg_catalog.pg_advisory_xact_lock(281028001);
  select * into r from private.site_customer_profiles where receipt_hash=receipt;
  if found then
    if r.nickname=nick and r.phone=p_phone and r.avatar=p_avatar then
      return pg_catalog.jsonb_build_object('code','KH'||pg_catalog.lpad(r.id::text,8,'0'),'created_at',r.created_at,'updated_at',r.updated_at);
    end if;
    if r.updated_at>pg_catalog.clock_timestamp()-interval '2 seconds' then raise exception '保存太频繁，请稍等片刻重试。'; end if;
    update private.site_customer_profiles set nickname=nick,phone=p_phone,avatar=p_avatar,updated_at=pg_catalog.clock_timestamp() where id=r.id returning * into r;
  else
    if (select count(*) from private.site_customer_profiles where created_at>now()-interval '1 minute')>=60
      or (select count(*) from private.site_customer_profiles where phone=p_phone and created_at>now()-interval '1 hour')>=3 then
      raise exception '当前提交较多，请稍后重试。';
    end if;
    insert into private.site_customer_profiles(receipt_hash,nickname,phone,avatar) values(receipt,nick,p_phone,p_avatar) returning * into r;
  end if;
  return pg_catalog.jsonb_build_object('code','KH'||pg_catalog.lpad(r.id::text,8,'0'),'created_at',r.created_at,'updated_at',r.updated_at);
end $$;

create function public.save_site_customer_profile(p_receipt text,p_nickname text,p_phone text,p_avatar text,p_consent boolean)
returns jsonb language sql security invoker set search_path = '' as $$
 select private.save_site_customer_profile(p_receipt,p_nickname,p_phone,p_avatar,p_consent);
$$;
revoke all on function private.save_site_customer_profile(text,text,text,text,boolean) from public;
revoke all on function public.save_site_customer_profile(text,text,text,text,boolean) from public;
grant usage on schema private to anon,authenticated;
grant execute on function private.save_site_customer_profile(text,text,text,text,boolean) to anon,authenticated;
grant execute on function public.save_site_customer_profile(text,text,text,text,boolean) to anon,authenticated;

create function private.site_admin_customer_profiles(p_page integer,p_page_size integer,p_snapshot bigint,p_avatars boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb; boundary bigint; total bigint;
begin
  if auth.uid() is null or not public.can_manage_all_parks() then raise exception '仅全园区管理员可查看客户登记资料。' using errcode='42501'; end if;
  if p_page is null or p_page<0 or p_page>100000 or p_page_size is null or p_page_size not between 1 and 200 then raise exception '分页参数无效。'; end if;
  select coalesce(p_snapshot,max(id),0) into boundary from private.site_customer_profiles;
  select count(*) into total from private.site_customer_profiles where id<=boundary;
  select coalesce(jsonb_agg(row order by id desc),'[]'::jsonb) into result from (
    select id,pg_catalog.jsonb_build_object('code','KH'||pg_catalog.lpad(id::text,8,'0'),'nickname',nickname,'phone',phone,
      'avatar',case when p_avatars then avatar else '' end,'has_avatar',avatar<>'','created_at',created_at,'updated_at',updated_at) as row
    from private.site_customer_profiles where id<=boundary order by id desc limit p_page_size offset p_page::bigint*p_page_size
  ) s;
  return pg_catalog.jsonb_build_object('rows',result,'total',total,'snapshot',boundary);
end $$;
create function public.site_admin_customer_profiles(p_page integer default 0,p_page_size integer default 20,p_snapshot bigint default null,p_avatars boolean default true)
returns jsonb language sql security invoker set search_path = '' as $$
 select private.site_admin_customer_profiles(p_page,p_page_size,p_snapshot,p_avatars);
$$;
revoke all on function private.site_admin_customer_profiles(integer,integer,bigint,boolean) from public,anon;
revoke all on function public.site_admin_customer_profiles(integer,integer,bigint,boolean) from public,anon;
grant execute on function private.site_admin_customer_profiles(integer,integer,bigint,boolean) to authenticated;
grant execute on function public.site_admin_customer_profiles(integer,integer,bigint,boolean) to authenticated;
notify pgrst,'reload schema';
