import { workspaceRequest, downloadCsv } from './admin-workspace';
import { beijingDate } from './inquiries';

export type CustomerProfile={code:string;nickname:string;phone:string;avatar:string;has_avatar:boolean;created_at:string;updated_at:string};
export type CustomerPage={rows:CustomerProfile[];total:number;snapshot:number};
export const loadCustomerProfiles=(page=0,size=20,snapshot:number|null=null,avatars=true)=>workspaceRequest<CustomerPage>('/rest/v1/rpc/site_admin_customer_profiles',{p_page:page,p_page_size:size,p_snapshot:snapshot,p_avatars:avatars});

export async function exportCustomerProfiles() {
  const first=await loadCustomerProfiles(0,200,null,false),rows=[...first.rows];
  if(first.total>100000)throw new Error('登记资料超过单次导出上限，请联系网站负责人分批导出。');
  for(let page=1;rows.length<first.total;page++) {
    const next=await loadCustomerProfiles(page,200,first.snapshot,false);
    if(!next.rows.length||next.total!==first.total)throw new Error('资料数量有变化，导出未完成，请重新导出。');
    rows.push(...next.rows);
  }
  if(rows.length!==first.total||new Set(rows.map(row=>row.code)).size!==rows.length)throw new Error('导出数据未完整读取，请重试。');
  downloadCsv(`客户登记资料-${beijingDate(new Date().toISOString(),true)}.csv`,['客户编号','称呼','手机号（未验证）','自定义头像','首次登记（北京时间）','最近修改（北京时间）'],rows.map(row=>[row.code,row.nickname,row.phone,row.has_avatar?'已设置':'未设置',beijingDate(row.created_at),beijingDate(row.updated_at)]));
  return rows.length;
}
