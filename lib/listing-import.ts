import type { LiveListing } from './backend';
import { REGION_LABELS, PUBLIC_REGIONS } from './regions';
import { listingErrors, publicListingPreview } from './listing-editor';

export type NoteIssue={field?:keyof LiveListing;message:string};
export type ParsedNote={listing:LiveListing;issues:NoteIssue[];warnings:string[];imagePaths:string[]};
const fields:Record<string,keyof LiveListing>={
 '对外标题':'title','房源类型':'category','类型':'category','园区名称':'park','楼栋':'building','楼层':'floor','房号':'room','租金单价':'price','物业费单价':'fee','业主底价':'owner_floor_price','业务底价':'owner_floor_price','支付方式':'payment_terms','免租期':'free_rent_period','面积':'area','朝向':'facing','格局':'layout','装修':'decoration','房源说明':'description','园区配套':'supporting_facilities','详细地址':'address','经度':'longitude','纬度':'latitude','招商':'contact_name','招商电话':'contact_phone','微信':'wechat','视频号':'video_channel','房源联系人':'owner_contact_name','房源联系人电话':'owner_contact_phone','房评':'description','房源亮点':'description','周边配套':'description','交通出行':'description','适配行业':'compatible_industries','层高':'factory_height','承重':'factory_load','配电':'factory_power','消防':'fire_rating','环评':'environmental_requirements'
};
const numeric=new Set(['price','fee','owner_floor_price','area','latitude','longitude']);
export const normalizeIdentity=(s:unknown)=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s\u200b\uFEFF]/g,'').replace(/[－–—﹣]/g,'-');
const locationPart=(s:unknown)=>normalizeIdentity(s).replace(/栋|幢|号楼|座|室|房|号/g,'');
export function propertyKey(l:LiveListing){return [normalizeIdentity(l.park),locationPart(l.building),locationPart(l.room),/^(整层|全层)$/.test(locationPart(l.room))?locationPart(l.floor):''].join('|');}
export function identityIssues(l:LiveListing):NoteIssue[]{
 const list:NoteIssue[]=[];
 for(const [key,label] of [['park','园区名称'],['building','楼栋'],['room','房号']] as const)if(!l[key]?.trim())list.push({field:key,message:`请补充${label}，用于查重；整栋或整层请明确填写。`});
 if(/^(整层|全层)$/.test(locationPart(l.room))&&!l.floor?.trim())list.push({field:'floor',message:'整层房源需要楼层，才能与其他楼层区分。'});
 return list;
}
export function publicImportIssues(l:LiveListing):NoteIssue[]{
 const list:NoteIssue[]=[];
 for(const field of ['title','description','supporting_facilities'] as const){
  const text=l[field]||'';
  if(/业主底价|业务底价|房源联系人|内部房号|内部联系/.test(text)||[l.owner_contact_phone,l.address].some(s=>s&&s.length>=5&&text.includes(s)))list.push({field,message:'对外内容含内部资料，请移到内部字段后再发布。'});
  const preview=publicListingPreview(l)[field];
  if(typeof preview==='string'&&preview!==text)list.push({field,message:'对外内容含园区或房号，请修改为公开片区等描述。'});
 }
 return list;
}
export function importIssues(l:LiveListing,publish:boolean){return [...identityIssues(l),...Object.entries(listingErrors(l,publish)).map(([field,message])=>({field:field as keyof LiveListing,message})),...(publish?publicImportIssues(l):[])];}

export function parseListingNote(raw:string,id:string):ParsedNote{
 const l:LiveListing={id,title:'',category:'写字楼',unit_split:true,field_visibility:{park:false,building:false,room:false,address:false,coordinates:false,wechat:false,video_channel:false},park:null,unit:null,building:null,room:null,floor:null,area:null,price:null,fee:null,facing:null,layout:null,decoration:null,description:null,address:null,latitude:null,longitude:null,contact_name:null,contact_phone:null,owner_contact_name:null,owner_contact_phone:null,images:[],videos:[],status:'draft'};
 const issues:NoteIssue[]=[],warnings:string[]=[],seen=new Set<string>(),imagePaths:string[]=[];
 const clean=raw.replace(/^\uFEFF/,'').replace(/[\u200b\uFEFF]/g,'');
 const imageRegex=/!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g;
 for(const m of clean.matchAll(imageRegex))imagePaths.push(m[1]||m[2]);
 let current:{field:keyof LiveListing;label:string}|null=null,categorySeen=false;
 for(const original of clean.replace(imageRegex,'').split(/\r?\n/)){
  const line=original.replace(/^\s*(?:[-*]\s+|>\s*)/,'').replace(/\*\*/g,'').trim();
  if(!line||line==='---'||/^#+\s/.test(line))continue;
  const m=line.match(/^([^:：]{1,30})[:：]\s*(.*)$/);
  if(!m){if(current&&!numeric.has(current.field)){const old=String(l[current.field]??'');Object.assign(l,{[current.field]:old+'\n'+line});}else issues.push({message:`无法识别这一行：${line.slice(0,45)}。请使用“字段：内容”。`});continue;}
  const label=m[1].trim(),value=m[2].trim();
  if(label==='所属片区'){
   if(seen.has(label)){issues.push({field:'region',message:'所属片区重复，请每套保留一个值。'});continue;}seen.add(label);
   const region=PUBLIC_REGIONS.find(r=>r===value||REGION_LABELS[r]===value);l.region=region||null;
   if(value&&!region)issues.push({field:'region',message:'片区未识别，请在编辑中选择正确片区。'});current=null;continue;
  }
  const field=fields[label];
  if(!field){issues.push({message:`未识别字段“${label}”，请使用模板字段后重新导出。`});current=null;continue;}
  if(seen.has(field)&&field!=='description'){issues.push({field,message:`字段“${label}”重复，请核对。`});continue;}seen.add(field);current={field,label};
  if(label==='业务底价')warnings.push('旧字段“业务底价”已按“业主底价”读取，仅后台保存。');
  if(numeric.has(field)){
   const v=value.normalize('NFKC').replace(/,/g,'').replace(/(?:元\s*\/\s*(?:㎡|m²|m2|平米|平方|平)\s*[·/.]?\s*月|(?:㎡|m²|m2|平方米|平米|平方|平)|元)\s*$/i,'').trim();
   if(!v||/^(未知|待确认|面议)$/.test(v))Object.assign(l,{[field]:null});
   else if(!/^-?\d+(?:\.\d+)?$/.test(v)||!Number.isFinite(Number(v)))issues.push({field,message:`“${label}”必须是明确数字；租金和物业费单位为元/㎡·月。`});
   else Object.assign(l,{[field]:Number(v)});
  }else if(field==='description'){
   const section=['房源说明','房评'].includes(label)?value:`${label}\n${value}`;
   l.description=[l.description,section].filter(Boolean).join('\n\n')||null;
  }else Object.assign(l,{[field]:value||null});
  if(field==='category')categorySeen=true;
 }
 if(!categorySeen)warnings.push('未填写房源类型，暂按写字楼读取；厂房请在编辑中改正。');
 if(!['写字楼','厂房','仓储'].includes(l.category))issues.push({field:'category',message:'房源类型请填写写字楼、厂房或仓储。'});
 if(l.layout)l.layout=l.layout.replace(/➕|＋/g,'+').replace(/\s/g,'');
 if(!l.title){const label=l.region?REGION_LABELS[l.region]:l.category;l.title=[label,l.decoration,l.area?`${l.area}㎡`:'',l.layout?`，${l.layout}格局`:''].filter(Boolean).join('');}
 l.unit=[l.building,l.room].filter(Boolean).join(' ')||null;
 return {listing:l,issues,warnings,imagePaths};
}
