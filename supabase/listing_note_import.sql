-- Explicit, admin-scoped imports. No existing listing is changed by this migration.
create table private.listing_note_imports (
 request_id uuid primary key, actor_id uuid not null, identity_key text not null,
 listing_id uuid not null references public.listings(id), created_at timestamptz not null default now()
);
alter table private.listing_note_imports enable row level security;
revoke all on private.listing_note_imports from public,anon,authenticated;

create function private.note_normalize(value text) returns text language sql immutable strict set search_path='' as $$
 select lower(regexp_replace(translate(normalize(value,NFKC),'－–—﹣','----'),'[[:space:]　​]+','','g'));
$$;
create function private.note_location(value text) returns text language sql immutable strict set search_path='' as $$
 select regexp_replace(private.note_normalize(value),'栋|幢|号楼|座|室|房|号','','g');
$$;
revoke all on function private.note_normalize(text),private.note_location(text) from public,anon,authenticated;

create function private.site_import_listing_note(p_request uuid,p_listing jsonb,p_mode text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.listings; old public.listings; receipt private.listing_note_imports; identity text; public_text text; image text; prefix text;
begin
 if auth.uid() is null or not coalesce(public.is_site_admin(),false) then raise insufficient_privilege using message='请先登录管理后台。'; end if;
 if p_request is null or p_mode is null or p_mode not in ('check','draft','published') or p_listing is null or jsonb_typeof(p_listing)<>'object' or octet_length(p_listing::text)>50000 then raise exception '导入参数不正确或内容过长。'; end if;
 l:=jsonb_populate_record(null::public.listings,p_listing);
 l.park:=nullif(btrim(l.park),'');l.building:=nullif(btrim(l.building),'');l.room:=nullif(btrim(l.room),'');
 if l.park is null or l.building is null or l.room is null then raise exception '请补充园区、楼栋和房号，用于查重。'; end if;
 if not coalesce(public.can_manage_park(l.park),false) then raise insufficient_privilege using message='当前账号不能导入该园区。'; end if;
 if length(l.park)>120 or length(l.building)>80 or length(l.room)>120 or length(coalesce(l.floor,''))>80 then raise exception '位置字段过长，请核对。';end if;
 if private.note_location(l.room) in ('整层','全层') and nullif(btrim(l.floor),'') is null then raise exception '整层房源需要楼层。';end if;
 identity:=concat_ws('|',private.note_normalize(l.park),private.note_location(l.building),private.note_location(l.room),case when private.note_location(l.room) in ('整层','全层') then private.note_location(l.floor) else '' end);
 -- All imports for one normalized park serialize: a second request sees the first insert.
 perform pg_advisory_xact_lock(hashtextextended('listing-note-import:'||private.note_normalize(l.park),0));
 select * into receipt from private.listing_note_imports where request_id=p_request;
 if found then
  if receipt.actor_id<>auth.uid() or receipt.identity_key<>identity then raise insufficient_privilege using message='该导入凭据不能用于本条资料。';end if;
  select * into old from public.listings where id=receipt.listing_id;
  if not coalesce(public.can_manage_park(old.park),false) then raise insufficient_privilege using message='当前账号不能查看该房源。';end if;
  return jsonb_build_object('status','saved','id',old.id,'code',old.internal_code,'mode',old.status);
 end if;
 select * into old from public.listings e where public.can_manage_park(e.park) and private.note_normalize(e.park)=private.note_normalize(l.park) and (
  (private.note_location(e.building)=private.note_location(l.building) and private.note_location(e.room)=private.note_location(l.room)
   and (private.note_location(l.room) not in ('整层','全层') or private.note_location(e.floor)=private.note_location(l.floor)))
  or (not coalesce(e.unit_split,false) and private.note_location(e.unit)=private.note_location(l.building||l.room))
 ) order by e.created_at limit 1;
 if found then return jsonb_build_object('status','duplicate','id',old.id,'code',old.internal_code,'message','相同园区、楼栋和房号已有记录（含草稿、下架或回收站），请核对后编辑原房源。');end if;
 -- Legacy records without complete room identity need human checking instead of guessing.
 if l.area is not null and l.floor is not null and exists(select 1 from public.listings e where public.can_manage_park(e.park) and private.note_normalize(e.park)=private.note_normalize(l.park) and (nullif(btrim(e.building),'') is null or nullif(btrim(e.room),'') is null) and private.note_location(e.floor)=private.note_location(l.floor) and abs(e.area-l.area)<0.01) then
  return jsonb_build_object('status','review','message','已有同园区、同楼层、同面积且位置不完整的房源，请先人工核对旧资料，避免重复。');
 end if;
 if p_mode='check' then return jsonb_build_object('status','new');end if;
 if exists(select 1 from public.listings where id=p_request) then raise exception '导入编号冲突，请重新选择资料。';end if;
 if l.category is null or l.category not in ('写字楼','厂房','仓储') then raise exception '请选择写字楼、厂房或仓储。';end if;
 if l.region is not null and l.region not in ('北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城') then raise exception '片区不正确。';end if;
 if l.area::text in ('NaN','Infinity','-Infinity') or l.price::text in ('NaN','Infinity','-Infinity') or l.fee::text in ('NaN','Infinity','-Infinity') or l.owner_floor_price::text in ('NaN','Infinity','-Infinity') then raise exception '数字必须有限且有效。';end if;
 if l.area<0 or l.price<0 or l.fee<0 or l.owner_floor_price<0 then raise exception '面积和单价不能为负数。';end if;
 if (l.latitude is null)<>(l.longitude is null) or abs(l.latitude)>90 or abs(l.longitude)>180 then raise exception '经纬度需要成对且在有效范围。';end if;
 if jsonb_typeof(coalesce(l.images,'[]'))<>'array' or jsonb_array_length(coalesce(l.images,'[]'))>20 then raise exception '照片列表不正确，最多20张。';end if;
 prefix:='https://zywbyjnbzgwmdypgobvh.supabase.co/storage/v1/object/public/listing-media/'||auth.uid()::text||'/';
 for image in select jsonb_array_elements_text(coalesce(l.images,'[]')) loop
  if left(image,length(prefix))<>prefix or substr(image,length(prefix)+1)!~'^[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then raise exception '照片地址不正确，请通过后台重新上传。';end if;
 end loop;
 if p_mode='published' then
  if nullif(btrim(l.title),'') is null or not coalesce(l.area>0,false) or nullif(btrim(l.contact_name),'') is null or nullif(btrim(l.contact_phone),'') is null or jsonb_array_length(coalesce(l.images,'[]'))<1 then raise exception '发布前需要标题、正数面积、招商姓名电话和照片。';end if;
  public_text:=concat_ws(' ',l.title,l.description,l.supporting_facilities);
  if public_text~'业主底价|业务底价|房源联系人|内部房号|内部联系'
   or (length(coalesce(l.owner_contact_phone,''))>=5 and strpos(public_text,l.owner_contact_phone)>0)
   or (length(coalesce(l.address,''))>=5 and strpos(public_text,l.address)>0)
   or (l.park not in ('北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城','松山湖北部','松山湖中部','松山湖南部','松山湖生态园','松山湖','近松山湖') and strpos(public_text,l.park)>0) then raise exception '对外标题或介绍含内部资料，请修改后再发布。';end if;
 end if;
 insert into public.listings(id,title,category,park,region,building,room,unit_split,unit,floor,area,price,fee,owner_floor_price,payment_terms,free_rent_period,facing,layout,decoration,description,supporting_facilities,address,longitude,latitude,contact_name,contact_phone,wechat,video_channel,owner_contact_name,owner_contact_phone,compatible_industries,factory_height,factory_load,factory_power,fire_rating,environmental_requirements,images,videos,status,field_visibility)
 values(p_request,coalesce(l.title,''),l.category,l.park,l.region,l.building,l.room,true,concat_ws(' ',l.building,l.room),l.floor,l.area,l.price,l.fee,l.owner_floor_price,l.payment_terms,l.free_rent_period,l.facing,l.layout,l.decoration,l.description,l.supporting_facilities,l.address,l.longitude,l.latitude,l.contact_name,l.contact_phone,l.wechat,l.video_channel,l.owner_contact_name,l.owner_contact_phone,l.compatible_industries,l.factory_height,l.factory_load,l.factory_power,l.fire_rating,l.environmental_requirements,coalesce(l.images,'[]'), '[]',p_mode,'{"park":false,"building":false,"room":false,"address":false,"coordinates":false,"wechat":false,"video_channel":false}') returning * into old;
 insert into private.listing_note_imports(request_id,actor_id,identity_key,listing_id) values(p_request,auth.uid(),identity,old.id);
 return jsonb_build_object('status','saved','id',old.id,'code',old.internal_code,'mode',old.status);
end $$;
revoke all on function private.site_import_listing_note(uuid,jsonb,text) from public,anon;
grant execute on function private.site_import_listing_note(uuid,jsonb,text) to authenticated;
create function public.site_import_listing_note(p_request uuid,p_listing jsonb,p_mode text default 'check')
returns jsonb language sql security invoker set search_path='' as $$ select private.site_import_listing_note(p_request,p_listing,p_mode); $$;
revoke all on function public.site_import_listing_note(uuid,jsonb,text) from public,anon;
grant execute on function public.site_import_listing_note(uuid,jsonb,text) to authenticated;
notify pgrst,'reload schema';
