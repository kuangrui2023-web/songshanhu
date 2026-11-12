"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Building2, Check, Download, MapPin, MessageSquare, Plus, Search, ShieldCheck, Users } from "lucide-react";
import type { LiveListing, SavedInquiry } from "@/lib/backend";
import { readSession } from "@/lib/backend";
import { beijingDate, inquiryExport, matchesInquiry } from '@/lib/inquiries';
import { sitePath } from '@/lib/site-path';
import { VisitorAnalytics } from '@/components/visitor-analytics';
import { CustomerProfiles } from '@/components/customer-profiles';
import { ALL_PARKS_SCOPE, adminRoleLabel, AdminEntry, changeOwnPassword, checkAdminService, createAdminAccount, downloadCsv, loadDirectory, manageAdmin, Metrics, Park, saveInquiry, savePark, saveSettings, SiteSettings, WorkspaceError } from "@/lib/admin-workspace";

const date = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN", {hour12:false}) : "—";
const detail = (e: unknown) => e instanceof Error ? e.message : "操作未完成，请稍后重试。";
function Feedback({error, message}: {error:string;message:string}) {
  return <>{error && <p className="admin-error" role="alert">{error}</p>}{message && <p className="admin-message" role="status"><Check size={18}/>{message}</p>}</>;
}
export function WorkspaceStats({items,inquiries,metrics,canViewCustomers=false}: {items:LiveListing[];inquiries:SavedInquiry[];metrics:Metrics|null;canViewCustomers?:boolean}) {
  const live=items.filter(x=>!x.deleted_at), messages=inquiries.filter(x=>!x.deleted_at);
  const pending=messages.filter(x=>(x.status||"pending")==="pending").length;
  const trend=metrics?.trend||[], maximum=Math.max(1,...trend.map(x=>Number(x.visitors)));
  return <div className="workspace-stack">
    <div className="workspace-metrics">
      <article><span>房源总数<Building2/></span><strong>{live.length}</strong><small>在租 {live.filter(x=>x.status==="published").length} · 草稿 {live.filter(x=>x.status==="draft"&&!x.withdrawn_at).length} · 下架 {live.filter(x=>x.status==="draft"&&x.withdrawn_at).length}</small></article>
      <article><span>累计访客<Users/></span><strong>{metrics ? metrics.visitors : "—"}</strong><small>今日 {metrics ? metrics.today_visitors : "—"} 人</small></article>
      <article><span>房源浏览量<BarChart3/></span><strong>{metrics ? metrics.views : "—"}</strong><small>今日 {metrics ? metrics.today_views : "—"} 次</small></article>
      <article><span>咨询留言<MessageSquare/></span><strong>{messages.length}</strong><small>待处理 {pending} · 已回复 {messages.filter(x=>x.status==="replied").length}</small></article>
    </div>
    <section className="workspace-card"><div className="workspace-card-heading"><h2>近 7 日访客趋势</h2><span>单位：人</span></div>
      {metrics ? <><div className="workspace-chart" role="img" aria-label={trend.map(x=>`${x.day}：${x.visitors}人`).join("；")}>{trend.map(day=><div className="workspace-chart-column" key={day.day}><span>{day.visitors}</span><i style={{height:`${Math.max(2,Number(day.visitors)/maximum*145)}px`}}/><small>{day.day.slice(5,10)}</small></div>)}</div><p className="workspace-help">仅统计启用后的本站访问，同一会话内重复打开不重复计数。{metrics.since ? `开始记录：${date(metrics.since)}。` : "暂时没有访问记录。"}</p></> : <p className="admin-empty">统计数据暂未加载，请点击刷新重试。</p>}
    </section>
    <section className="workspace-card"><div className="workspace-card-heading"><h2>房源浏览 TOP 5</h2><span>真实累计浏览</span></div>{metrics?.top.length ? metrics.top.map((item,i)=><div className="workspace-ranking" key={item.id}><b>{i+1}</b><span>{item.title}</span><strong>{item.views}<small> 次</small></strong></div>) : <p className="admin-empty">还没有房源浏览记录。</p>}</section>
    {canViewCustomers&&<CustomerProfiles/>}
    <VisitorAnalytics items={items} inquiries={inquiries} revision={metrics}/>
  </div>;
}

export function InquiryWorkspace({items,inquiries,onRefresh}: {items:LiveListing[];inquiries:SavedInquiry[];onRefresh:()=>Promise<void>}) {
  const [filter,setFilter]=useState("pending"),[keyword,setKeyword]=useState(""),[kind,setKind]=useState("all");
  const [from,setFrom]=useState(''),[to,setTo]=useState('');
  const [editing,setEditing]=useState<SavedInquiry|null>(null),[reply,setReply]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const active=inquiries.filter(x=>!x.deleted_at), pending=active.filter(x=>(x.status||"pending")==="pending");
  const listings=new Map(items.map(item=>[item.id,item]));
  const rows=inquiries.filter(x=>(kind==="all"||(x.kind||"inquiry")===kind)&&(filter==="trash"?!!x.deleted_at:!x.deleted_at&&(filter==="all"||(x.status||"pending")===filter))&&matchesInquiry(x,listings.get(x.listing_id||''),keyword,from,to));
  function exportRows(selected:SavedInquiry[],scope:string){const data=inquiryExport(selected,items);downloadCsv(`咨询留言-${scope}-${beijingDate(new Date().toISOString(),true)}.csv`,data.headers,data.rows);}
  async function update(item:SavedInquiry,status:string,text:string,archived=false) {
    setBusy(true);setError("");setMessage("");
    try { await saveInquiry(item.id,status,text,archived);await onRefresh();setEditing(null);setMessage(archived?"留言已移入回收站，可随时恢复。":item.deleted_at?"留言已恢复。":"留言处理结果已保存。"); }
    catch(e){setError(detail(e));}finally{setBusy(false);}
  }
  return <div className="workspace-stack">
    <div className="workspace-chips" aria-label="提交类型筛选">{[["all","全部提交"],["inquiry","房源咨询"],["company","企业资料"],["need","选址需求"]].map(([value,label])=><button key={value} className={kind===value?"active":""} aria-pressed={kind===value} onClick={()=>setKind(value)}>{label} {active.filter(x=>value==="all"||(x.kind||"inquiry")===value).length}</button>)}</div>
    <div className="workspace-summary"><div><strong>{pending.length}</strong><span>待回复</span></div><div><strong>{active.filter(x=>x.status==="replied").length}</strong><span>已回复</span></div><div><strong>{active.length}</strong><span>留言总数</span></div></div>
    <Feedback error={error} message={message}/>
    <div className="workspace-toolbar inquiry-toolbar"><label className="workspace-search"><Search size={18}/><input value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder="搜索房源编号、称呼、手机号或留言" aria-label="搜索留言"/></label><button type="button" disabled={!rows.length} className="admin-secondary" onClick={()=>exportRows(rows,'筛选结果')}><Download size={16}/>导出筛选结果（{rows.length}）</button><button type="button" disabled={!active.length} className="admin-secondary" onClick={()=>exportRows(active,'全部有效留言')}>导出全部有效留言（{active.length}）</button></div>
    <div className="inquiry-date-filters"><label>提交开始日期<input type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)}/></label><label>提交结束日期<input type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)}/></label>{(from||to||keyword)&&<button type="button" className="admin-secondary" onClick={()=>{setFrom('');setTo('');setKeyword('');}}>清除搜索和日期</button>}</div>
    <p className="workspace-help">日期按北京时间筛选。筛选导出遵循当前类型、状态、日期和关键词；全部有效留言导出忽略筛选、不含回收站。文件含客户联系方式，请妥善保管。</p>
    <div className="workspace-chips" aria-label="留言状态筛选">{[["pending","待回复"],["replied","已回复"],["closed","已完成"],["all","全部"],["trash","回收站"]].map(([value,label])=><button key={value} className={filter===value?"active":""} aria-pressed={filter===value} onClick={()=>setFilter(value)}>{label}</button>)}</div>
    {rows.length===0 ? <div className="workspace-card admin-empty">当前条件下没有留言。</div> : rows.map(item=><article className="workspace-card workspace-inquiry" key={item.id}>
      <div className="workspace-card-heading"><h3>{item.contact} · {item.phone}</h3><span className={`workspace-status ${item.status||"pending"}`}>{item.visitor_withdrawn_at?"访客已撤回":item.deleted_at?"已移入回收站":item.status==="replied"?"已回复":item.status==="closed"?"已完成":"待回复"}</span></div>
      {item.listing_id&&<p className="workspace-inquiry-listing">房源编号：<strong>{listings.get(item.listing_id)?.internal_code||'待确认'}</strong>{listings.has(item.listing_id)&&<a href={sitePath(`/experience/?id=${encodeURIComponent(item.listing_id)}`)} target="_blank" rel="noopener noreferrer">查看房源 ↗</a>}</p>}
      <p className="workspace-help"><strong>{item.kind==="company"?"企业资料登记":item.kind==="need"?"选址需求登记":"房源咨询"}</strong> · {item.company} · {items.find(x=>x.id===item.listing_id)?.title||"未关联房源"}</p><p className="workspace-quote">{item.request_text||"预约看房"}</p>{item.kind==="company"&&<dl className="workspace-quote"><dt>企业名称</dt><dd>{item.details?.name||item.company}</dd><dt>所属行业</dt><dd>{item.details?.industry||"未填写"}</dd><dt>主营产品／服务</dt><dd>{item.details?.product||"未填写"}</dd><dt>企业简介</dt><dd>{item.details?.intro||"未填写"}</dd></dl>}{item.kind==="need"&&<p className="workspace-help">需求类型：{item.details?.type||"其他"}</p>}{item.viewing_at&&<p className="workspace-help">希望看房：{date(item.viewing_at)}</p>}
      {item.reply&&<p className="workspace-reply"><strong>招商顾问回复</strong>{item.reply}<small>{date(item.replied_at)}</small></p>}<time className="workspace-help">{date(item.created_at)}</time>
      {editing?.id===item.id&&!item.visitor_withdrawn_at ? <form className="workspace-reply-form" onSubmit={e=>{e.preventDefault();void update(item,"replied",reply);}}><label>回复内容<textarea autoFocus rows={4} maxLength={4000} required value={reply} onChange={e=>setReply(e.target.value)}/></label><p className="workspace-help">回复会显示在客户提交时浏览器的「留言咨询」中，不会自动发送短信或微信通知。电话联系可点下方拨号。</p><div className="workspace-actions"><button disabled={busy} className="admin-primary">{busy?"保存中…":"保存回复"}</button><button type="button" disabled={busy} className="admin-secondary" onClick={()=>setEditing(null)}>取消</button></div></form> : <div className="workspace-actions">
        {item.visitor_withdrawn_at ? <p className="workspace-help">访客已删除并撤回此留言；若对方修改后重新提交，请处理新留言。</p> : item.deleted_at ? <button disabled={busy} className="admin-secondary" onClick={()=>void update(item,item.status||"pending",item.reply||"",false)}>恢复留言</button> : <><button disabled={busy} className="workspace-op" onClick={()=>{setEditing(item);setReply(item.reply||"");setError("");setMessage("");}}>{item.reply?"修改回复":"回复"}</button><a className="workspace-op neutral" href={`tel:${item.phone}`}>拨打电话</a>{item.status!=="closed"&&<button disabled={busy} className="workspace-op neutral" onClick={()=>void update(item,"closed",item.reply||"")}>标记完成</button>}<button disabled={busy} className="workspace-op danger" onClick={()=>{if(confirm("将这条留言移入回收站？之后可以恢复。"))void update(item,item.status||"pending",item.reply||"",true);}}>移入回收站</button></>}
      </div>}
    </article>)}
  </div>;
}

const newPark = ():Park => ({id:crypto.randomUUID(),name:"",address:"",latitude:null,longitude:null,contact_name:"",contact_phone:"",description:"",active:true});
export function ParkWorkspace({parks,items,isSuper,onRefresh}: {parks:Park[];items:LiveListing[];isSuper:boolean;onRefresh:()=>Promise<void>}) {
  const [editing,setEditing]=useState<Park|null>(null),[keyword,setKeyword]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const rows=parks.filter(x=>[x.name,x.address].join(" ").includes(keyword.trim()));
  async function persist(park:Park) {
    if((park.latitude===null)!==(park.longitude===null)){setError("经纬度需要一起填写，或同时留空。");return;}
    setBusy(true);setError("");setMessage("");
    try {await savePark(park);await onRefresh();setEditing(null);setMessage("园区信息已保存，网站刷新后生效。");}catch(e){setError(detail(e));}finally{setBusy(false);}
  }
  function field<K extends keyof Park>(key:K,value:Park[K]){setEditing(x=>x?{...x,[key]:value}:null);}
  return <div className="workspace-stack">
    <p className="workspace-notice">园区名称会同步到房源表单和网站筛选。经纬度使用高德坐标（GCJ-02），没有确认的位置可先留空。</p>
    <Feedback error={error} message={message}/>
    {editing ? <form className="workspace-card" onSubmit={e=>{e.preventDefault();void persist(editing);}}><div className="workspace-card-heading"><h2>{parks.some(x=>x.id===editing.id)?"编辑园区":"新增园区"}</h2><button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消编辑</button></div><fieldset className="admin-fields" disabled={busy}><div className="admin-form-grid">
      <label>园区名称 *<input autoFocus required maxLength={120} value={editing.name} onChange={e=>field("name",e.target.value)}/></label><label>园区地址<input maxLength={300} value={editing.address} onChange={e=>field("address",e.target.value)}/></label>
      <label>纬度<input type="number" step="0.000001" min={-90} max={90} value={editing.latitude??""} onChange={e=>field("latitude",e.target.value?Number(e.target.value):null)}/></label><label>经度<input type="number" step="0.000001" min={-180} max={180} value={editing.longitude??""} onChange={e=>field("longitude",e.target.value?Number(e.target.value):null)}/></label>
      <label>招商联系人<input maxLength={60} value={editing.contact_name} onChange={e=>field("contact_name",e.target.value)}/></label><label>联系电话<input type="tel" maxLength={40} value={editing.contact_phone} onChange={e=>field("contact_phone",e.target.value)}/></label><label className="admin-wide">园区介绍<textarea rows={4} maxLength={4000} value={editing.description} onChange={e=>field("description",e.target.value)}/></label>
      </div><p className="workspace-help">修改园区名称时，关联房源与园区管理员的所属名称会一起更新；修改园区坐标不会覆盖已单独定位的房源。</p><button className="admin-primary">{busy?"保存中…":"保存园区"}</button></fieldset></form> : <>
      <div className="workspace-toolbar"><label className="workspace-search"><Search size={18}/><input value={keyword} onChange={e=>setKeyword(e.target.value)} aria-label="搜索园区" placeholder="搜索园区名称或地址"/></label>{isSuper&&<button className="admin-primary" onClick={()=>{setEditing(newPark());setError("");setMessage("");}}><Plus size={18}/>新增园区</button>}</div>
      <section className="workspace-card"><div className="workspace-card-heading"><h2>产业园区</h2><span>{parks.filter(x=>x.active).length} 个启用</span></div>{rows.length?rows.map(park=><article className="workspace-park" key={park.id}><div className="workspace-park-avatar">{park.name.slice(0,1)}</div><div className="workspace-park-info"><h3>{park.name}<small>{items.filter(x=>x.park===park.name&&!x.deleted_at).length} 套房源</small>{!park.active&&<small>已停用</small>}</h3><p>{park.address||"地址待补充"}</p><p><MapPin size={13}/>{park.latitude!==null&&park.longitude!==null?`${park.latitude}, ${park.longitude}`:"经纬度待补充"}</p></div>{isSuper&&<div className="workspace-actions vertical"><button disabled={busy} className="workspace-op" onClick={()=>{setEditing({...park});setError("");setMessage("");}}>编辑</button><button disabled={busy} className="workspace-op neutral" onClick={()=>{if(confirm(park.active?"停用该园区？仍关联房源或管理员时无法停用。":"重新启用该园区？"))void persist({...park,active:!park.active});}}>{park.active?"停用":"启用"}</button></div>}</article>):<p className="admin-empty">暂无匹配的园区，可新增真实园区资料。</p>}</section>
    </>}
  </div>;
}

export function SettingsWorkspace({settings,parks,isSuper,onRefresh}: {settings:SiteSettings;parks:Park[];isSuper:boolean;onRefresh:()=>Promise<void>}) {
  const [draft,setDraft]=useState(settings),[directory,setDirectory]=useState<AdminEntry[]>([]);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [account,setAccount]=useState<{email:string;name:string;park:string;password:string;repeat:string;existing:boolean}|null>(null);
  const [accountError,setAccountError]=useState("");
  const [accountService,setAccountService]=useState({checking:false,error:"",ready:false});
  const [serviceAttempt,setServiceAttempt]=useState(0),[directoryError,setDirectoryError]=useState("");
  const [accountRecovery,setAccountRecovery]=useState(false);
  const resultNotice=useRef<HTMLDivElement>(null),mutationPending=useRef(false);
  useEffect(()=>{if(error||message){resultNotice.current?.scrollIntoView({block:"nearest",behavior:window.matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth"});resultNotice.current?.focus({preventScroll:true});}},[error,message]);
  const accountFeedback=useRef<HTMLDivElement>(null),accountForm=useRef<HTMLFormElement>(null),accountPending=useRef(false);
  const [member,setMember]=useState<AdminEntry|null>(null),[passwordForm,setPasswordForm]=useState(false),[newPassword,setNewPassword]=useState(""),[repeatPassword,setRepeatPassword]=useState("");
  useEffect(()=>{setDraft(settings);},[settings]);
  useEffect(()=>{if(accountError)accountFeedback.current?.scrollIntoView({block:"nearest",behavior:window.matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth"});},[accountError]);
  useEffect(()=>{if(account)accountForm.current?.scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth"});},[Boolean(account)]);
  const checkingNewAccount=Boolean(account&&!account.existing);
  useEffect(()=>{
    if(!checkingNewAccount)return;
    let live=true;setAccountService({checking:true,error:"",ready:false});
    checkAdminService().then(()=>{if(live)setAccountService({checking:false,error:"",ready:true});}).catch(e=>{if(live)setAccountService({checking:false,error:detail(e),ready:false});});
    return()=>{live=false;};
  },[checkingNewAccount,serviceAttempt]);
  useEffect(()=>{let live=true;loadDirectory().then(rows=>{if(live)setDirectory(rows);}).catch(e=>{if(live)setDirectoryError(detail(e));}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[]);
  async function reloadDirectory() {
    if(loading||busy)return;
    setLoading(true);setDirectoryError("");
    try {setDirectory(await loadDirectory());}catch(e){setDirectoryError(detail(e));}finally{setLoading(false);}
  }
  async function run(action:()=>Promise<unknown>,success:string) {
    if(mutationPending.current||busy)return false;
    mutationPending.current=true;setBusy(true);setError("");setMessage("");
    try {
      await action();setAccount(null);setMember(null);setMessage(success);
      const refreshed=await Promise.allSettled([loadDirectory(),onRefresh()]);
      if(refreshed[0].status==="fulfilled"){setDirectory(refreshed[0].value);setDirectoryError("");}
      else setDirectoryError(detail(refreshed[0].reason));
      if(refreshed.some(result=>result.status==="rejected"))setMessage(success+" 列表刷新未完成，请刷新核对，不要重复提交。");
      return true;
    } catch(e){setError(detail(e));return false;}
    finally{mutationPending.current=false;setBusy(false);}
  }
  async function addAccount(event:React.FormEvent) {
    event.preventDefault();if(!account||busy||accountPending.current)return;
    setAccountError("");setAccountRecovery(false);setError("");setMessage("");
    const email=account.email.trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setAccountError("请填写正确的邮箱地址。");return;}
    if(account.park!==ALL_PARKS_SCOPE&&!parks.some(park=>park.active&&park.name===account.park)){setAccountError("请选择「全部园区」或一个启用的园区。");return;}
    if(!account.existing&&(account.password.length<12||account.password.length>128)){setAccountError("新账号的初始密码需要 12–128 位。");return;}
    if(!account.existing&&account.password!==account.repeat){setAccountError("两次输入的初始密码不一致。");return;}
    if(!account.existing&&!accountService.ready){setAccountError(accountService.checking?"正在核对账号服务连接，请稍候再提交。":accountService.error||"账号服务尚未连接，请点击「重试连接账号服务」。");return;}
    accountPending.current=true;setBusy(true);
    try {
      if(account.existing)await manageAdmin("add",{email,display_name:account.name.trim(),park:account.park});
      else await createAdminAccount({email,name:account.name.trim(),park:account.park,password:account.password});
      setAccount(null);setMessage("管理权限已开通，可使用该邮箱和本站密码登录后台。");
      const refreshed=await Promise.allSettled([loadDirectory(),onRefresh()]);
      if(refreshed[0].status==="fulfilled"){setDirectory(refreshed[0].value);setDirectoryError("");}else setDirectoryError(detail(refreshed[0].reason));
      if(refreshed.some(result=>result.status==="rejected"))setMessage("管理权限已开通，但列表刷新未完成。请点击刷新数据，不要重复开通。");
    }catch(e){
      const text=detail(e);
      setAccountRecovery(e instanceof WorkspaceError&&["EMAIL_EXISTS","AUTHORIZATION_PENDING"].includes(e.code));
      setAccountError(/尚未创建登录账号/.test(text)?"这个邮箱还没有本站登录账号。请切换到「创建新账号」，填写初始密码后开通。":text);
    }finally{accountPending.current=false;setBusy(false);}
  }
  async function changePassword(event:React.FormEvent) {
    event.preventDefault();if(busy||mutationPending.current)return;if(newPassword!==repeatPassword){setError("两次输入的新密码不一致。");return;}
    mutationPending.current=true;setBusy(true);setError("");setMessage("");
    try {await changeOwnPassword(newPassword);setNewPassword("");setRepeatPassword("");setPasswordForm(false);setMessage("你的登录密码已修改，请妥善保存。");}catch(e){setError(detail(e));}finally{mutationPending.current=false;setBusy(false);}
  }
  return <div className="workspace-stack">
    <p className="workspace-notice">{isSuper?`管理员数量上限为 ${settings.admin_limit} 人。只有超级管理员可新增账号、调整管理范围及停用管理权限。`:"你可以查看自己的账号并修改本人密码。平台设置和人员管理由超级管理员维护。"}</p>
    {(error||message)&&<div ref={resultNotice} tabIndex={-1}><Feedback error={error} message={message}/></div>}
    <section className="workspace-card"><div className="workspace-card-heading"><h2><ShieldCheck size={20}/>管理员账号</h2><span>{loading?"读取中…":`${directory.length} / ${isSuper?settings.admin_limit:"本人账号"}`}</span></div>
      <div className="workspace-actions"><button type="button" className="admin-secondary" disabled={busy||loading} onClick={()=>void reloadDirectory()}>{loading?"读取中…":"刷新管理员列表"}</button></div>
      {directoryError&&<p className="admin-error" role="alert">管理员列表未刷新：{directoryError}</p>}
      {isSuper&&<p className="workspace-help">可选择单个园区或「全部园区（房源与留言）」。全园区管理员不能管理账号或修改平台设置；停用或移除权限不会删除业务数据和登录账号。</p>}
      {!loading&&!directoryError&&directory.length===0&&<p className="admin-empty">暂无可查看的管理员账号。</p>}
      {directory.map(entry=><article className="workspace-member" key={entry.user_id}><div className={`workspace-member-avatar ${entry.role==="superadmin"?"super":""}`}>{entry.role==="superadmin"?"超":"管"}</div><div className="workspace-member-info"><h3>{entry.display_name||adminRoleLabel(entry.role)}<small className="workspace-role">{entry.active?adminRoleLabel(entry.role):"已停用"}</small></h3><p>{entry.email}</p>{entry.role==="content_admin"?<p>管理范围：全部园区（房源与留言）</p>:entry.park&&<p>负责园区：{entry.park}</p>}<small>创建 {date(entry.created_at)} · 最近登录 {date(entry.last_sign_in_at)}</small></div><div className="workspace-actions vertical">
        {entry.user_id===readSession()?.user.id&&<button disabled={busy} className="workspace-op neutral" onClick={()=>{setPasswordForm(!passwordForm);setNewPassword("");setRepeatPassword("");setError("");setMessage("");}}>修改密码</button>}
        {isSuper&&<button disabled={busy} className="workspace-op" onClick={()=>{setMember({...entry});setAccount(null);setError("");setMessage("");}}>编辑</button>}
        {isSuper&&entry.role!=="superadmin"&&<><button disabled={busy} className="workspace-op neutral" onClick={()=>{if(confirm(entry.active?"停用该管理员的后台权限？":"重新启用该管理员？"))void run(()=>manageAdmin("update",{...entry,active:!entry.active}),"管理权限已更新。");}}>{entry.active?"停用":"启用"}</button><button disabled={busy} className="workspace-op danger" onClick={()=>{if(confirm("移除该账号的管理权限？登录账号会保留，之后可以重新授权。"))void run(()=>manageAdmin("remove",entry),"管理权限已移除。");}}>移除</button></>}
      </div></article>)}
      {isSuper&&<button className="admin-primary workspace-block" disabled={busy||loading||!!directoryError||directory.length>=settings.admin_limit} onClick={()=>{setAccountError("");setAccountRecovery(false);setMember(null);setAccount({email:"",name:"",park:parks.find(x=>x.active)?.name||"",password:"",repeat:"",existing:false});setError("");setMessage("");}}><Plus size={18}/>新增管理员</button>}
    </section>
    {passwordForm&&<form className="workspace-card" onSubmit={changePassword}><h2>修改本人密码</h2><fieldset className="admin-fields" disabled={busy}><div className="admin-form-grid"><label>新密码<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label><label>再次输入新密码<input type="password" autoComplete="new-password" minLength={12} required value={repeatPassword} onChange={e=>setRepeatPassword(e.target.value)}/></label></div><p className="workspace-help">至少 12 位，建议使用密码管理器生成并保存。只会修改当前登录账号的密码。</p><div className="workspace-actions"><button className="admin-primary">{busy?"保存中…":"修改密码"}</button><button className="admin-secondary" type="button" onClick={()=>{setPasswordForm(false);setNewPassword("");setRepeatPassword("");}}>取消</button></div></fieldset></form>}
    {account&&<form ref={accountForm} className="workspace-card workspace-account-form" onSubmit={addAccount} noValidate aria-busy={busy}>
      <h2>新增管理员</h2>
      <fieldset className="admin-fields" disabled={busy}>
        <div className="workspace-account-modes" role="group" aria-label="账号开通方式">
          <button type="button" aria-pressed={!account.existing} onClick={()=>{setAccount({...account,existing:false,password:"",repeat:""});setAccountError("");setAccountRecovery(false);}}>创建新账号</button>
          <button type="button" aria-pressed={account.existing} onClick={()=>{setAccount({...account,existing:true,password:"",repeat:""});setAccountError("");setAccountRecovery(false);}}>授权已有账号</button>
        </div>
        <p className="workspace-account-hint">{account.existing?"仅用于已经有本站登录账号的邮箱。只有邮箱、尚未注册本站账号时，请选择「创建新账号」。":"第一次开通请选择此项：同时创建邮箱登录账号，并授予所选范围的管理权限。"}</p>
        {!account.existing&&<p className={accountService.error?"admin-error":"workspace-help"} role="status">{accountService.checking?"正在核对云端账号服务…":accountService.error?`账号服务未连接：${accountService.error}`:accountService.ready?"云端账号服务已连接。":""}</p>}
        {!account.existing&&accountService.error&&<button type="button" className="admin-secondary" onClick={()=>setServiceAttempt(value=>value+1)}>重试连接账号服务</button>}
        <div className="admin-form-grid">
          <label>邮箱 *<input type="email" required maxLength={254} autoComplete="off" value={account.email} onChange={e=>setAccount({...account,email:e.target.value})}/></label>
          <label>姓名<input maxLength={60} value={account.name} onChange={e=>setAccount({...account,name:e.target.value})}/></label>
          <label>管理范围 *<select required value={account.park} onChange={e=>setAccount({...account,park:e.target.value})}><option value="" disabled>请选择管理范围</option><option value={ALL_PARKS_SCOPE}>全部园区（房源与留言）</option>{parks.filter(x=>x.active).map(x=><option key={x.id} value={x.name}>{x.name}</option>)}</select></label>
          {!account.existing&&<><label>初始密码 *<input type="password" autoComplete="new-password" minLength={12} maxLength={128} required placeholder="12–128 位，由你设置" value={account.password} onChange={e=>setAccount({...account,password:e.target.value})}/></label><label>再次输入初始密码 *<input type="password" autoComplete="new-password" minLength={12} required value={account.repeat} onChange={e=>setAccount({...account,repeat:e.target.value})}/></label></>}
        </div>
        <p className="workspace-help">{account.park===ALL_PARKS_SCOPE?"该账号可管理全部园区的房源和留言（含未关联房源的咨询），不能管理其他管理员或修改平台设置。":"该账号仅管理所选园区的房源及关联留言。"}不会自动发送邀请邮件。</p>
        <div ref={accountFeedback} className="workspace-account-feedback" aria-live="polite" aria-atomic="true">
          {busy&&<p className="admin-message" role="status">正在连接云端并开通权限，请勿重复提交…</p>}
          {accountError&&<><p className="admin-error" role="alert">{accountError}</p><button type="button" className="admin-secondary" disabled={loading} onClick={()=>void reloadDirectory()}>刷新管理员列表核对</button></>}
          {accountRecovery&&<button type="button" className="admin-secondary" onClick={()=>{setAccount({...account,existing:true,password:"",repeat:""});setAccountError("");setAccountRecovery(false);}}>转为授权已有账号</button>}
        </div>
        <div className="workspace-actions"><button className="admin-primary" type="submit" disabled={!account.existing&&accountService.checking}>{busy?"开通中…":!account.existing&&accountService.checking?"连接账号服务中…":account.existing?"授予管理权限":"创建账号并开通权限"}</button><button type="button" className="admin-secondary" onClick={()=>{setAccount(null);setAccountError("");}}>取消</button></div>
      </fieldset>
    </form>}
    {member&&<form className="workspace-card" onSubmit={e=>{e.preventDefault();void run(()=>manageAdmin("update",member),"管理员信息已保存。");}}><h2>编辑管理员</h2><fieldset className="admin-fields" disabled={busy}><div className="admin-form-grid"><label>邮箱<input disabled value={member.email}/></label><label>姓名<input maxLength={60} value={member.display_name} onChange={e=>setMember({...member,display_name:e.target.value})}/></label>{member.role!=="superadmin"&&<label>管理范围<select required value={member.role==="content_admin"?ALL_PARKS_SCOPE:member.park||""} onChange={e=>setMember({...member,role:e.target.value===ALL_PARKS_SCOPE?"content_admin":"park_admin",park:e.target.value===ALL_PARKS_SCOPE?null:e.target.value})}><option value={ALL_PARKS_SCOPE}>全部园区（房源与留言）</option>{parks.filter(x=>x.active).map(x=><option key={x.id}>{x.name}</option>)}</select></label>}</div><div className="workspace-actions"><button className="admin-primary">保存管理员</button><button type="button" className="admin-secondary" onClick={()=>setMember(null)}>取消</button></div></fieldset></form>}
    <form className="workspace-card" onSubmit={e=>{e.preventDefault();void run(()=>saveSettings(draft),"平台参数已保存，网站刷新后生效。");}}><div className="workspace-card-heading"><h2>平台参数</h2>{!isSuper&&<span>仅查看</span>}</div><fieldset className="admin-fields" disabled={busy||!isSuper}><div className="admin-form-grid"><label>平台名称<input required maxLength={60} value={draft.platform_name} onChange={e=>setDraft({...draft,platform_name:e.target.value})}/></label><label>招商热线<input type="tel" maxLength={40} value={draft.hotline} onChange={e=>setDraft({...draft,hotline:e.target.value})}/></label><label>管理员人数上限<input type="number" min={Math.max(1,directory.length)} max={20} required value={draft.admin_limit} onChange={e=>setDraft({...draft,admin_limit:Number(e.target.value)})}/></label><label>分享标题<input maxLength={120} value={draft.share_title} onChange={e=>setDraft({...draft,share_title:e.target.value})}/></label><label className="admin-wide">分享简介<textarea rows={3} maxLength={240} value={draft.share_description} onChange={e=>setDraft({...draft,share_description:e.target.value})}/></label><label className="admin-wide">分享封面图片网址<input type="url" pattern="https://.*" value={draft.share_image} placeholder="https://…（可留空）" onChange={e=>setDraft({...draft,share_image:e.target.value})}/></label></div><p className="workspace-help">平台名称、热线和分享信息会公开展示。房源自己的联系人与电话优先显示。</p>{isSuper&&<button className="admin-primary">{busy?"保存中…":"保存平台参数"}</button>}</fieldset></form>
  </div>;
}
