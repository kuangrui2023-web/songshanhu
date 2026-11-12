import { workspaceRequest,downloadCsv } from './admin-workspace';
import { visitorCode,type VisitorSummary,type VisitRecord } from './visitor-analytics';
import { beijingDate } from './inquiries';

type ExportKind='summary'|'views';
export type ExportRow=VisitorSummary|(VisitRecord&{visitor_id:string});
type ExportPage={rows:ExportRow[];total:number;snapshot:number;page:number;page_size:number};

export async function exportAnonymousVisits(kind:ExportKind){
  const load=(page:number,snapshot:number|null)=>workspaceRequest<ExportPage>('/rest/v1/rpc/site_admin_visit_export',{p_kind:kind,p_page:page,p_page_size:500,p_snapshot:snapshot});
  const first=await load(0,null),rows=[...first.rows];
  if(!Number.isSafeInteger(first.total)||first.total<0||first.total>100000)throw new Error('导出记录超过单次上限或数量异常，请联系网站负责人分批处理。');
  const size=first.page_size;
  if(!Number.isInteger(size)||size<1||size>500)throw new Error('导出分页异常，请重试。');
  for(let page=1;rows.length<first.total;page++){
    const next=await load(page,first.snapshot);
    if(!next.rows.length||next.total!==first.total||next.snapshot!==first.snapshot||next.page!==page||next.page_size!==size)throw new Error('导出期间记录范围变化，未生成文件，请重试。');
    rows.push(...next.rows);
  }
  const keys=rows.map(row=>kind==='summary'?row.visitor_id:String((row as VisitRecord).id));
  if(rows.length!==first.total||new Set(keys).size!==rows.length)throw new Error('访问记录未完整读取，未生成文件，请重试。');
  const name=kind==='summary'?'匿名访客汇总':'匿名房源浏览明细';
  const headers=kind==='summary'?['访客编号（浏览器标识）','浏览器标识UUID','首次访问（北京时间）','最近访问（北京时间）','会话数','房源浏览数']:['访客编号（浏览器标识）','浏览器标识UUID','访问时间（北京时间）','房源编号','房源名称','房源ID'];
  const values=rows.map(row=>{
    if(kind==='summary'){
      const item=row as VisitorSummary;
      return [visitorCode(item.visitor_id),item.visitor_id,beijingDate(item.first_seen),beijingDate(item.last_seen),item.sessions,item.views];
    }
    const item=row as VisitRecord&{visitor_id:string};
    return [visitorCode(item.visitor_id),item.visitor_id,beijingDate(item.created_at),item.listing_code||'',item.title||'房源已移除',item.listing_id||''];
  });
  downloadCsv(`${name}-${beijingDate(new Date().toISOString(),true)}.csv`,headers,values);
  return rows.length;
}
