import { accessToken, backendKey, backendUrl, type LiveListing } from './backend';
import { listingCode } from './listing-code';

export type ListingFilters={status:string;park:string;keyword:string};
export const listingExportHeaders=['园区名称','系统房号（房源编号）','园区房号','楼栋','历史楼栋房号（未拆分原文）','楼层','面积㎡','系统状态','标题','租金单价（元/㎡·月）','物业费单价（元/㎡·月）','装修','格局','招商顾问','招商电话','资料核对提示'];
const text=(value:unknown)=>String(value??'').trim();
export function listingStatus(item:LiveListing){return item.deleted_at?'回收站':item.status==='published'?'在租':item.withdrawn_at?'已下架':'草稿';}
export function filterListings(items:LiveListing[],filters:ListingFilters){
 return items.filter(item=>{
  if(filters.status==='trash'?!item.deleted_at:!!item.deleted_at)return false;
  if(filters.status==='published'&&item.status!=='published')return false;
  if(filters.status==='draft'&&(item.status!=='draft'||item.withdrawn_at))return false;
  if(filters.status==='offline'&&(item.status!=='draft'||!item.withdrawn_at))return false;
  if(filters.park&&item.park!==filters.park)return false;
  const code=listingCode(filters.keyword);if(code)return item.internal_code===code;
  return [item.title,item.park,item.unit,item.building,item.room,item.internal_code].join(' ').toLowerCase().includes(filters.keyword.trim().toLowerCase());
 });
}
export function listingExport(items:LiveListing[]){
 const sorted=[...items].sort((a,b)=>{
  for(const key of ['park','building','room','internal_code','id'] as const){
   const x=text(a[key]),y=text(b[key]);if(!x&&y)return 1;if(x&&!y)return -1;
   const n=x.localeCompare(y,'zh-CN',{numeric:true});if(n)return n;
  }return 0;
 });
 let incomplete=0;
 const rows=sorted.map(x=>{
  const missing=[!text(x.park)&&'园区名称',!text(x.internal_code)&&'系统房号',!text(x.room)&&'园区房号'].filter(Boolean);
  if(missing.length)incomplete++;
  return [x.park,x.internal_code,x.room,x.building,x.unit_split?'':x.unit,x.floor,x.area,listingStatus(x),x.title,x.price,x.fee,x.decoration,x.layout,x.contact_name,x.contact_phone,missing.length?`缺少${missing.join('、')}，请核对补充`:text(x.building)?'':'楼栋未填，请按园区实际情况核对'];
 });
 return {headers:listingExportHeaders,rows,incomplete};
}
const exportColumns='id,internal_code,park,building,room,unit,unit_split,floor,area,title,price,fee,decoration,layout,contact_name,contact_phone,status,withdrawn_at,deleted_at';
// Keep existing administrator JWT and row policies; never use a service key for export.
export async function loadListingExport(fetcher:typeof fetch=fetch):Promise<LiveListing[]>{
 const token=await accessToken(),rows:LiveListing[]=[],seen=new Set<string>();let total:number|undefined;
 for(let page=0;page<1000;page++){
  const response=await fetcher(`${backendUrl}/rest/v1/listings?select=${exportColumns}&order=id.asc&limit=500&offset=${rows.length}`,{headers:{apikey:backendKey,Authorization:`Bearer ${token}`,Prefer:'count=exact'},cache:'no-store',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(response.status===401||response.status===403?'登录或导出权限已变化，请重新登录后再试。':`导出读取失败（${response.status}），未下载不完整清单，请重试。`);
  const data:LiveListing[]=await response.json(),range=response.headers.get('content-range')||'',match=range.match(/^(?:(\d+)-(\d+)|\*)\/(\d+)$/);
  if(!Array.isArray(data)||!match)throw new Error('无法确认完整导出数量，未下载文件，请刷新后重试。');
  const count=Number(match[3]);if(count>100000)throw new Error('房源数量超过单次导出上限，请联系负责人处理。');
  if(total===undefined)total=count;else if(total!==count)throw new Error('导出期间房源范围发生变化，请重新导出。');
  if(!count&&data.length===0)return [];
  if(Number(match[1])!==rows.length||Number(match[2])-Number(match[1])+1!==data.length||!data.length)throw new Error('房源分页记录不完整，未下载文件，请重试。');
  for(const item of data){if(!item.id||seen.has(item.id))throw new Error('导出记录发生变化或重复，请重新导出。');seen.add(item.id);rows.push(item);}
  if(rows.length===total)return rows;
  if(rows.length>total)throw new Error('导出数量不一致，未下载文件，请重试。');
 }
 throw new Error('导出超过分页上限，未下载不完整文件。');
}
