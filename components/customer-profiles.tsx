'use client';

import { useEffect,useState } from 'react';
import { loadCustomerProfiles,exportCustomerProfiles,type CustomerPage } from '@/lib/customer-profiles';
import { beijingDate } from '@/lib/inquiries';

export function CustomerProfiles() {
  const [page,setPage]=useState(0),[revision,setRevision]=useState(0),[data,setData]=useState<CustomerPage|null>(null);
  const [busy,setBusy]=useState(true),[exporting,setExporting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    let active=true;setBusy(true);setError('');setData(null);
    loadCustomerProfiles(page).then(result=>{
      if(!active)return;
      if(page>0&&result.total<=page*20){setPage(Math.max(0,Math.ceil(result.total/20)-1));return;}
      setData(result);
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'客户资料加载失败，请重试。');}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[page,revision]);
  async function exportAll(){
    setExporting(true);setError('');setNotice('');
    try{const count=await exportCustomerProfiles();setNotice(`已导出 ${count} 条客户登记资料。`);}
    catch(e){setError(e instanceof Error?e.message:'导出未完成，请重试。');}
    finally{setExporting(false);}
  }
  return <section className="workspace-card" aria-labelledby="customer-profiles-title">
    <div className="workspace-card-heading"><h2 id="customer-profiles-title">客户登记资料</h2><div className="workspace-actions"><button type="button" className="admin-secondary" disabled={busy||exporting} onClick={()=>setRevision(n=>n+1)}>刷新客户资料</button><button type="button" className="admin-secondary" disabled={busy||exporting||!data?.total} onClick={()=>void exportAll()}>{exporting?'正在导出…':'导出全部客户资料'}</button></div></div>
    <p className="workspace-help">客户在「我的 → 填写／编辑资料」主动保存后生成固定编号。手机号未经验证，不代表正式登录账号，也不与匿名访问自动关联。本栏仅全园区管理员可查看及导出。</p>
    {error&&<p className="admin-error" role="alert">{error}</p>}{notice&&<p className="admin-message" role="status">{notice}</p>}
    <div aria-live="polite">{busy?<p className="admin-empty">正在加载客户资料…</p>:data&&!data.rows.length?<p className="admin-empty">暂无客户登记资料；既有本机资料需客户主动重新保存后才会上传。</p>:null}</div>
    {!!data?.rows.length&&<div className="visitor-table-scroll"><table className="visitor-table"><caption className="sr-only">已主动登记的客户资料</caption><thead><tr><th>头像</th><th>客户编号</th><th>称呼</th><th>手机号（未验证）</th><th>首次登记（北京时间）</th><th>最近修改（北京时间）</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.code}><td>{/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(row.avatar)?<img className="customer-table-avatar" src={row.avatar} width="40" height="40" alt={`${row.nickname}的头像`}/>:<span className="customer-table-avatar customer-avatar-initial">{row.nickname.slice(0,1)}</span>}</td><th scope="row">{row.code}</th><td>{row.nickname}</td><td><a href={`tel:${row.phone}`}>{row.phone}</a></td><td>{beijingDate(row.created_at)}</td><td>{beijingDate(row.updated_at)}</td></tr>)}</tbody></table></div>}
    {data&&<div className="visitor-pager"><span>共 {data.total} 条 · 第 {page+1} / {Math.max(1,Math.ceil(data.total/20))} 页</span><button type="button" className="admin-secondary" disabled={busy||page===0} onClick={()=>setPage(n=>n-1)}>上一页</button><button type="button" className="admin-secondary" disabled={busy||(page+1)*20>=data.total} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}
  </section>;
}
