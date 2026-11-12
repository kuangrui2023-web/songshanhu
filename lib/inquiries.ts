import type { LiveListing, SavedInquiry } from './backend';
import { listingCode } from './listing-code';

export const isPendingInquiry=(item:SavedInquiry)=>!item.deleted_at&&!item.visitor_withdrawn_at&&(item.status||'pending')==='pending';
export const newPendingInquiryIds=(rows:SavedInquiry[],seen:ReadonlySet<string>)=>rows.filter(item=>!seen.has(item.id)&&isPendingInquiry(item)).map(item=>item.id);
export const inquiryStatus=(item:SavedInquiry)=>item.visitor_withdrawn_at?'访客已撤回':item.deleted_at?'回收站':item.status==='replied'?'已回复':item.status==='closed'?'已完成':'待回复';
export const inquiryKind=(item:SavedInquiry)=>item.kind==='company'?'企业资料':item.kind==='need'?'选址需求':'房源咨询';
export function beijingDate(value?:string|null,dayOnly=false){
  if(!value||!Number.isFinite(Date.parse(value)))return '';
  const date=new Date(value),parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',...(dayOnly?{}:{hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23' as const})}).formatToParts(date);
  const part=(type:string)=>parts.find(p=>p.type===type)?.value||'';
  const day=`${part('year')}-${part('month')}-${part('day')}`;
  return dayOnly?day:`${day} ${part('hour')}:${part('minute')}:${part('second')}`;
}
export function matchesInquiry(item:SavedInquiry,listing:LiveListing|undefined,keyword:string,from:string,to:string){
  const day=beijingDate(item.created_at,true);
  if((from&&(!day||day<from))||(to&&(!day||day>to)))return false;
  const code=listingCode(keyword);
  if(code)return listing?.internal_code===code;
  return [item.company,item.contact,item.phone,item.request_text,item.reply,listing?.title,listing?.internal_code].join(' ').toLowerCase().includes(keyword.trim().toLowerCase());
}
export function inquiryExport(rows:SavedInquiry[],items:LiveListing[]){
  const listings=new Map(items.map(item=>[item.id,item]));
  return {
    headers:['提交类型','公司','联系人','电话','房源编号','房源标题','留言内容','希望看房时间（北京时间）','处理状态','回复内容','提交时间（北京时间）','回复时间（北京时间）','回收时间（北京时间）','撤回时间（北京时间）','所属行业','主营产品或服务','企业简介','需求类型'],
    rows:rows.map(item=>{const listing=listings.get(item.listing_id||'');return [inquiryKind(item),item.company,item.contact,item.phone,listing?.internal_code||'',listing?.title||'',item.request_text||'',beijingDate(item.viewing_at),inquiryStatus(item),item.reply||'',beijingDate(item.created_at),beijingDate(item.replied_at),beijingDate(item.deleted_at),beijingDate(item.visitor_withdrawn_at),item.details?.industry||'',item.details?.product||'',item.details?.intro||'',item.details?.type||''];})
  };
}
