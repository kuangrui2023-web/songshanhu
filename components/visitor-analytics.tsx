'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { LiveListing, SavedInquiry } from '@/lib/backend';
import { loadVisitorPage, loadVisitorHistory, type Metrics } from '@/lib/admin-workspace';
import { activeLeadRecords, visitorCode, type VisitorSummary, type VisitRecord, type VisitPage } from '@/lib/visitor-analytics';
import { beijingDate, inquiryKind } from '@/lib/inquiries';
import { sitePath } from '@/lib/site-path';
import { exportAnonymousVisits } from '@/lib/visitor-export';

const message = (error:unknown) => error instanceof Error?error.message:'访问记录暂未加载，请重试。';
const time = (value:string) => beijingDate(value)||'—';

function Pager({page,total,busy,onChange}:{page:number;total:number;busy:boolean;onChange:(page:number)=>void}) {
  const pages=Math.max(1,Math.ceil(total/20));
  return <div className="visitor-pager"><span>共 {total} 条 · 第 {page+1} / {pages} 页</span><button type="button" className="admin-secondary" disabled={busy||page===0} onClick={()=>onChange(page-1)}>上一页</button><button type="button" className="admin-secondary" disabled={busy||page+1>=pages} onClick={()=>onChange(page+1)}>下一页</button></div>;
}

export function VisitorAnalytics({items,inquiries,revision}:{items:LiveListing[];inquiries:SavedInquiry[];revision:Metrics|null}) {
  const [page,setPage]=useState(0),[refresh,setRefresh]=useState(0),[selected,setSelected]=useState<string|null>(null);
  const [visitors,setVisitors]=useState<VisitPage<VisitorSummary>|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [historyPage,setHistoryPage]=useState(0),[history,setHistory]=useState<VisitPage<VisitRecord>|null>(null),[historyBusy,setHistoryBusy]=useState(false),[historyError,setHistoryError]=useState('');
  const historyHeading=useRef<HTMLDivElement>(null);
  const [leadPage,setLeadPage]=useState(0);
  const [exporting,setExporting]=useState<'summary'|'views'|null>(null),[exportError,setExportError]=useState(''),[exportNotice,setExportNotice]=useState('');
  const leads=activeLeadRecords(inquiries),leadLastPage=Math.max(0,Math.ceil(leads.length/20)-1),shownLeadPage=Math.min(leadPage,leadLastPage);
  const listings=new Map(items.map(item=>[item.id,item]));
  async function exportRecords(kind:'summary'|'views'){
    setExporting(kind);setExportError('');setExportNotice('');
    try{const count=await exportAnonymousVisits(kind);setExportNotice(`已导出 ${count} 条${kind==='summary'?'匿名访客汇总':'房源浏览明细'}，仅包含当前账号可查看的记录。`);}
    catch(e){setExportError(message(e));}finally{setExporting(null);}
  }

  useEffect(()=>{
    let active=true;
    setBusy(true);setError('');setVisitors(null);
    loadVisitorPage(page).then(data=>{
      if(!active)return;
      if(page>0&&data.total<=page*20){setPage(Math.max(0,Math.ceil(data.total/20)-1));return;}
      setVisitors(data);
    }).catch(e=>{if(active)setError(message(e));}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[page,refresh,revision]);

  useEffect(()=>{
    let active=true;
    setHistory(null);setHistoryError('');
    if(!selected){setHistoryBusy(false);return ()=>{active=false;};}
    setHistoryBusy(true);
    loadVisitorHistory(selected,historyPage).then(data=>{if(active)setHistory(data);})
      .catch(e=>{if(active)setHistoryError(message(e));}).finally(()=>{if(active)setHistoryBusy(false);});
    return ()=>{active=false;};
  },[selected,historyPage,refresh,revision]);

  useEffect(()=>{
    if(selected)historyHeading.current?.scrollIntoView({block:'start',behavior:'instant'});
  },[selected]);

  return <>
    <section className="workspace-card" aria-labelledby="visitor-list-title">
      <div className="workspace-card-heading"><h2 id="visitor-list-title">匿名访问明细</h2><div className="workspace-actions"><button type="button" className="admin-secondary" disabled={busy||historyBusy||!!exporting} onClick={()=>setRefresh(value=>value+1)}>刷新访问记录</button><button type="button" className="admin-secondary" disabled={busy||!!exporting} onClick={()=>void exportRecords('summary')}>{exporting==='summary'?'正在导出…':'导出访客汇总'}</button><button type="button" className="admin-secondary" disabled={busy||!!exporting} onClick={()=>void exportRecords('views')}>{exporting==='views'?'正在导出…':'导出房源浏览明细'}</button></div></div>
      <p className="workspace-help">编号区分浏览器，不代表真实身份；换设备或清除浏览器数据会产生新编号。时间均为北京时间，仅显示当前账号有权查看的访问。</p>
      <p className="workspace-help">导出包含全部有权查看的记录，不限当前页；房源浏览沿用同一会话、同一房源只计一次的规则。CSV 不包含客户姓名或联系方式。</p>
      {exportError&&<p className="admin-error" role="alert">{exportError}</p>}{exportNotice&&<p className="admin-message" role="status">{exportNotice}</p>}
      {error&&<p className="admin-error" role="alert">{error}</p>}
      <div aria-live="polite">{busy?<p className="admin-empty">正在加载访问记录…</p>:visitors&&!visitors.rows.length?<p className="admin-empty">暂无可查看的访问记录。</p>:null}</div>
      {!!visitors?.rows.length&&<div className="visitor-table-scroll"><table className="visitor-table"><caption className="sr-only">匿名访客及访问时间</caption><thead><tr><th>访客编号</th><th>首次访问</th><th>最近访问</th><th>会话数</th><th>房源浏览数</th><th>访问详情</th></tr></thead><tbody>{visitors.rows.map(row=><Fragment key={row.visitor_id}><tr><th scope="row" title={row.visitor_id}>{visitorCode(row.visitor_id)}</th><td>{time(row.first_seen)}</td><td>{time(row.last_seen)}</td><td>{row.sessions}</td><td>{row.views}</td><td><button type="button" className="workspace-op" aria-expanded={selected===row.visitor_id} aria-controls={selected===row.visitor_id?`visitor-history-${row.visitor_id}`:undefined} onClick={()=>{setHistory(null);setHistoryError('');setHistoryBusy(selected!==row.visitor_id);setSelected(selected===row.visitor_id?null:row.visitor_id);setHistoryPage(0);}}> {selected===row.visitor_id?'收起记录':'查看房源记录'}</button></td></tr>      {selected===row.visitor_id&&<tr className="visitor-history-row"><td colSpan={6}><div id={`visitor-history-${row.visitor_id}`} className="visitor-history" role="region" aria-label={`${visitorCode(row.visitor_id)}的房源浏览记录`}><div className="workspace-card-heading" ref={historyHeading}><h3>{visitorCode(selected)} · 房源浏览记录</h3><button type="button" className="admin-secondary" onClick={()=>setSelected(null)}>关闭记录</button></div><p className="workspace-help">沿用现有计数规则：同一会话内重复打开同一房源只记一次，不是全部点击次数。</p>
        {historyError&&<p className="admin-error" role="alert">{historyError}</p>}
        <div aria-live="polite">{historyBusy?<p>正在加载房源记录…</p>:history&&!history.rows.length?<p>该访客暂无可查看的房源浏览记录。</p>:null}</div>
        {!!history?.rows.length&&<div className="visitor-table-scroll"><table className="visitor-table"><caption className="sr-only">所选匿名访客看过的房源</caption><thead><tr><th>访问时间（北京时间）</th><th>房源编号</th><th>房源</th></tr></thead><tbody>{history.rows.map(row=><tr key={row.id}><td>{time(row.created_at)}</td><td>{row.listing_code||'—'}</td><td>{row.listing_id?<a href={sitePath(`/experience/?id=${encodeURIComponent(row.listing_id)}`)} target="_blank" rel="noopener noreferrer">{row.title||'房源资料暂不可用'} ↗</a>:'房源已移除'}</td></tr>)}</tbody></table></div>}
        {history&&<Pager page={historyPage} total={history.total} busy={historyBusy} onChange={setHistoryPage}/>}
      </div></td></tr>}</Fragment>)}</tbody></table></div>}
      {visitors&&<Pager page={page} total={visitors.total} busy={busy} onChange={next=>{setSelected(null);setPage(next);}}/>}

    </section>
    <section className="workspace-card" aria-labelledby="visitor-leads-title"><div className="workspace-card-heading"><h2 id="visitor-leads-title">已留资记录</h2><span>按提交记录列出</span></div><p className="workspace-help">仅展示客户主动提交的称呼、联系方式和关联房源；资料未经身份验证，不与匿名访问自动关联。完整留言和回复请在「留言」栏目查看。</p>
      {leads.length?<div className="visitor-table-scroll"><table className="visitor-table"><caption className="sr-only">客户主动提交的联系资料</caption><thead><tr><th>提交时间（北京时间）</th><th>称呼／公司</th><th>联系电话</th><th>提交类型</th><th>关联房源</th></tr></thead><tbody>{leads.slice(shownLeadPage*20,shownLeadPage*20+20).map(row=>{const listing=listings.get(row.listing_id||'');return <tr key={row.id}><td>{time(row.created_at)}</td><td><strong>{row.contact}</strong><small>{row.company||'未填写公司'}</small></td><td><a href={`tel:${row.phone}`}>{row.phone}</a></td><td>{inquiryKind(row)}</td><td>{listing?[listing.internal_code,listing.title].filter(Boolean).join(' · '):'未关联可查看的房源'}</td></tr>;})}</tbody></table></div>:<p className="admin-empty">暂无有效留资记录。</p>}
      <Pager page={shownLeadPage} total={leads.length} busy={false} onChange={setLeadPage}/>
    </section>
  </>;
}
