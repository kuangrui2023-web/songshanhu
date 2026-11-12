import type { LiveListing, PublicListing } from './backend';
export type VisibilityKey = 'park'|'building'|'floor'|'room'|'address'|'coordinates'|'has_agent_fee'|'wechat'|'video_channel';
const defaultPrivate = new Set<VisibilityKey>(['has_agent_fee','wechat','video_channel']);
export const visibleField=(item:LiveListing,key:VisibilityKey)=>['park','room','building','address','coordinates'].includes(key)?false:defaultPrivate.has(key)?item.field_visibility?.[key]===true:item.field_visibility?.[key]!==false;
export const isIndustrial=(category:string)=>category==='厂房'||category==='仓储';
export const industrialFields=['compatible_industries','factory_height','factory_load','factory_power','fire_rating','environmental_requirements','has_crane_support','freight_elevator_load','freight_elevator_size','has_passenger_elevator','has_water'] as const;
function publicText(value:string,item:LiveListing){
  let result=value;
  const broad=new Set(['北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城','松山湖北部','松山湖中部','松山湖南部','松山湖生态园','松山湖','近松山湖']);
  const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  for(const secret of [item.park,item.address])if(secret&&secret.trim().length>=2&&!broad.has(secret))result=result.replace(new RegExp(escape(secret),'gi'),'[位置资料已隐藏]');
  if(item.room&&/^[A-Za-z0-9-]+$/.test(item.room))result=result.replace(new RegExp('(?<![A-Za-z0-9.])'+escape(item.room)+'(?![A-Za-z0-9.])','gi'),'[房号已隐藏]');
  return result;
}
export function publicListingPreview(item:LiveListing):PublicListing {
  const {internal_code,owner_floor_price,owner_contact_name,owner_contact_phone,channel_notes,followup_notes,has_agent_fee,wechat,video_channel,field_visibility,unit_split,...result}=item;
  void internal_code;void owner_floor_price;void owner_contact_name;void owner_contact_phone;void channel_notes;void followup_notes;void field_visibility;void unit_split;
  const building=visibleField(item,'building')?item.building:null,room=visibleField(item,'room')?item.room:null;
  const unit=item.unit_split?[building,room].filter(Boolean).join(' ')||null:visibleField(item,'building')&&visibleField(item,'room')?item.unit:null;
  const redacted=Object.fromEntries(Object.entries(result).map(([key,value])=>[key,typeof value==='string'&&!['id','contact_name','contact_phone','status','created_at','updated_at','first_published_at','withdrawn_at','deleted_at'].includes(key)?publicText(value,item):value]));
  return {...result,...redacted,listing_code:/^[0-9]{6}$/.test(item.internal_code||'')?item.internal_code:null,has_agent_fee:visibleField(item,'has_agent_fee')?has_agent_fee:null,wechat:visibleField(item,'wechat')?wechat:null,video_channel:visibleField(item,'video_channel')?video_channel:null,unit,building:item.unit_split?building:null,room:item.unit_split?room:null,
    park:visibleField(item,'park')?item.park:null,floor:visibleField(item,'floor')?item.floor:null,
    address:visibleField(item,'address')?item.address:null,latitude:visibleField(item,'coordinates')?item.latitude:null,longitude:visibleField(item,'coordinates')?item.longitude:null,
    ...(!isIndustrial(item.category)?Object.fromEntries(industrialFields.map(key=>[key,null])):{})};
}
export function listingErrors(item:LiveListing,publish:boolean):Record<string,string>{
  const errors:Record<string,string>={};
  if(publish){
    if(!item.title.trim())errors.title='发布前请填写对外房源标题。';
    if(!item.park?.trim())errors.park='发布前请填写内部归属园区，可选择仅后台保存。';
    if(!(typeof item.area==='number'&&Number.isFinite(item.area)&&item.area>0))errors.area='发布前请填写大于0的房源面积。';
    if(!item.contact_name?.trim())errors.contact_name='发布前请填写对外招商顾问姓名。';
    if(!item.contact_phone?.trim())errors.contact_phone='发布前请填写对外招商顾问电话。';
    if(item.images.length<1)errors.images='请至少上传1张真实房源照片，也可以先保存草稿。';
  }
  for(const key of ['area','price','fee','owner_floor_price'] as const){const value=item[key];if(value!=null&&(!Number.isFinite(value)||value<0))errors[key]='请填写有效的非负数字，未确认时请留空。';}
  if((item.latitude==null)!==(item.longitude==null))errors[item.latitude==null?'latitude':'longitude']='经纬度需要成对填写，或同时留空。';
  if(item.latitude!=null&&(!Number.isFinite(item.latitude)||Math.abs(item.latitude)>90))errors.latitude='纬度范围应为-90至90。';
  if(item.longitude!=null&&(!Number.isFinite(item.longitude)||Math.abs(item.longitude)>180))errors.longitude='经度范围应为-180至180。';
  return errors;
}
