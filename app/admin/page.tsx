"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, LogOut, Plus, Save, Trash2, Upload, Download, RefreshCw, Search, Building2, MessageSquare, BarChart3, MapPin, Settings } from "lucide-react";
import { type AdminRole, adminProfile, backendReady, deleteListing, LiveListing, loadAll, loadInquiries, readSession, SavedInquiry, saveListing, signIn, signOut, uploadMedia } from "@/lib/backend";
import { adminRoleLabel, defaultSettings, downloadCsv, loadMetrics, loadParks, loadSettings, Metrics, Park, SiteSettings } from "@/lib/admin-workspace";
import { InquiryWorkspace, ParkWorkspace, SettingsWorkspace, WorkspaceStats } from "@/components/admin-workspace";
import { ListingFields, ListingPreview } from "@/components/listing-fields";
import { listingErrors } from "@/lib/listing-editor";
import { sitePath } from "@/lib/site-path";
import { AdminTabs } from "@/components/admin-tabs";
import { InquiryNotifier } from '@/components/inquiry-notifier';
import { listingCode } from '@/lib/listing-code';
import { prepareListingImage,imageSizeLabel } from '@/lib/image-upload';
import { ListingBulkImport } from '@/components/listing-bulk-import';
import { filterListings, listingExport, loadListingExport } from '@/lib/listing-export';

const blank = (): LiveListing => ({ id: crypto.randomUUID(), title: "", category: "写字楼", unit_split:true,field_visibility:{room:false}, park: null, unit: null, floor: null, area: null, price: null, fee: null, facing: null, layout: null, decoration: null, description: null, address: null, latitude: null, longitude: null, contact_name: null, contact_phone: null, owner_contact_name: null, owner_contact_phone: null, tag: null, images: [], videos: [], status: "draft" });
type UploadEntry = { id: string; name: string; percent: number; state: "queued" | "compressing" | "uploading" | "success" | "error"; error?: string; optimization?:string };

export default function AdminPage() {
  const [previewOpen,setPreviewOpen] = useState(false);
  const [bulkOpen,setBulkOpen]=useState(false),[bulkDirty,setBulkDirty]=useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [checking, setChecking] = useState(true);
  const [items, setItems] = useState<LiveListing[]>([]);
  const [inquiries, setInquiries] = useState<SavedInquiry[]>([]);
  const [inquiriesLoaded,setInquiriesLoaded]=useState(false);
  const [section, setSection] = useState<"listings" | "inquiries" | "stats" | "map" | "parks" | "settings">("listings");
  const [parks, setParks] = useState<Park[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(defaultSettings);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [assignedPark, setAssignedPark] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [parkFilter, setParkFilter] = useState("");
  const [editing, setEditing] = useState<LiveListing | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState<UploadEntry[]>([]);
  const [busyAction, setBusyAction] = useState<"upload" | "draft" | "published" | "delete" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const draggedPhoto = useRef<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!backendReady || !readSession()) { setChecking(false); return; }
    adminProfile().then(async profile => {
      if (profile) { setRole(profile.role); setAssignedPark(profile.park || null); setEmail(readSession()?.user.email || ""); setAuthorized(true); await refreshData(); }
      else signOut();
    }).catch(e => setError(e instanceof Error ? e.message : "连接失败")).finally(() => setChecking(false));
  }, []);

  async function refreshData() {
    setRefreshing(true);
    try {
      const results = await Promise.allSettled([loadAll(), loadInquiries(), loadParks(), loadSettings(), loadMetrics()] as const);
      if (results[0].status === "fulfilled") setItems(results[0].value);
      if (results[1].status === "fulfilled") {setInquiries(results[1].value);setInquiriesLoaded(true);}
      if (results[2].status === "fulfilled") setParks(results[2].value);
      if (results[3].status === "fulfilled") setSettings(results[3].value);
      if (results[4].status === "fulfilled") setMetrics(results[4].value);
      const failure = results.find(result => result.status === "rejected");
      if (failure?.status === "rejected") setError(`部分数据未加载：${failure.reason instanceof Error ? failure.reason.message : "请稍后刷新重试"}`);
    } finally { setRefreshing(false); }
  }
  const liveItems = items.filter(item=>!item.deleted_at);
  const activeInquiries = inquiries.filter(item=>!item.deleted_at);
  const pending = activeInquiries.filter(item=>(item.status||"pending")==="pending").length;
  const visibleItems = filterListings(items,{status:statusFilter,park:parkFilter,keyword});
  async function exportListings(){
    const filters={status:statusFilter,park:parkFilter,keyword};
    setSaving(true);setError("");setMessage("正在读取有权查看的房源并生成核对清单…");
    try{
      const result=listingExport(filterListings(await loadListingExport(),filters));
      if(!result.rows.length){setMessage("当前筛选条件下没有可导出的房源。");return;}
      const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      const park=(filters.park||'全部园区').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_');
      downloadCsv(`${park}-房源核对清单-${date}.csv`,result.headers,result.rows);
      setMessage(`已导出 ${result.rows.length} 套，按园区、楼栋和房号排列，沿用当前筛选条件。${result.incomplete?`其中 ${result.incomplete} 套缺少园区、系统编号或园区房号，已在“资料核对提示”列标出；请补充原资料。`:""}已下架状态不等于已出租，出租情况请人工核实。`);
    }catch(e){setMessage("");setError(e instanceof Error?e.message:"导出失败，未下载不完整文件，请重试。");}finally{setSaving(false);}
  }
  function startNew() { setEditing({...blank(),park:role==="park_admin"?assignedPark:null});setUploads([]);setFieldErrors({});setMessage("");setError(""); }
  function hasUnsavedChanges() {
    if(bulkOpen&&bulkDirty)return true;
    if(!editing)return false;
    const baseline=items.find(item=>item.id===editing.id)||{...blank(),id:editing.id,park:role==="park_admin"?assignedPark:null};
    return JSON.stringify(editing)!==JSON.stringify(baseline);
  }
  function closeEditor() {
    if(hasUnsavedChanges()&&!confirm("房源资料尚未保存，确定返回列表？"))return;
    setEditing(null);setPreviewOpen(false);setFieldErrors({});setError("");
  }
  function switchSection(next:typeof section) {
    if(hasUnsavedChanges()&&!confirm("房源资料尚未保存，确定切换板块？"))return;
    setSection(next);setBulkOpen(false);setBulkDirty(false);setEditing(null);setPreviewOpen(false);setMessage("");setError("");
  }
  function selectPark(value:string) {
    const park=parks.find(x=>x.name===value&&x.active);
    setEditing(current=>current?{...current,park:value||null,...(park?{address:current.address||park.address}: {})}:null);
    setFieldErrors(current=>({...current,park:""}));setError("");
  }
  async function changeListingStatus(item:LiveListing,restore=false) {
    const publishing=!restore&&item.status!=="published";
    const issues=listingErrors(item,publishing);
    if(publishing&&Object.keys(issues).length){setEditing({...item});setUploads([]);setFieldErrors(issues);setError("资料未齐，请补充标出的项目后发布。");return;}
    setSaving(true);setError("");setMessage("");
    try {
      await saveListing({...item,status:restore?"draft":item.status==="published"?"draft":"published",deleted_at:restore?null:item.deleted_at,withdrawn_at:restore?item.withdrawn_at:item.status==="published"?new Date().toISOString():null});
      await refreshData();setMessage(restore?"房源已恢复为草稿，请核对后再发布。":item.status==="published"?"房源已下架。":"房源已发布。");
    }catch(e){setError(e instanceof Error?e.message:"状态修改未完成，请重试。");}finally{setSaving(false);}
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setChecking(true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("请填写完整的管理员邮箱，例如 name@qq.com；这里不能填写 admin 用户名。"); setChecking(false); return;
    }
    if (!password) { setError("请填写管理员密码。"); setChecking(false); return; }
    try {
      await signIn(email, password);
      const profile = await adminProfile();
      if (!profile) { signOut(); throw new Error("该邮箱尚未开通管理权限，或权限已停用，请联系网站负责人。"); }
      setRole(profile.role); setAssignedPark(profile.park || null); setAuthorized(true); setPassword(""); await refreshData();
    } catch (e) { setError(e instanceof Error ? e.message : "登录失败"); }
    finally { setChecking(false); }
  }
  function change<K extends keyof LiveListing>(key: K, value: LiveListing[K]) {
    setEditing(current => current ? { ...current, [key]: value } : null);
    setError("");
    setFieldErrors(errors => { const next={...errors}; delete next[key]; return next; });
  }
  function movePhoto(from: number, to: number) {
    if (saving || !editing || from === to || to < 0 || to >= editing.images.length) return;
    const positions = new Map(Array.from(document.querySelectorAll<HTMLElement>(".admin-media[data-photo-key]")).map(node=>[node.dataset.photoKey,node.getBoundingClientRect()]));
    const images=[...editing.images]; const [photo]=images.splice(from,1); images.splice(to,0,photo); change("images",images);
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(()=>{
      document.querySelectorAll<HTMLElement>(".admin-media[data-photo-key]").forEach(node=>{
        const old=positions.get(node.dataset.photoKey), current=node.getBoundingClientRect();
        if(old) node.animate([{transform:`translate(${old.left-current.left}px,${old.top-current.top}px)`},{transform:"translate(0,0)"}],{duration:240,easing:"cubic-bezier(.22,1,.36,1)"});
      });
    });
  }
  function validation(errors: Record<string,string>) {
    setFieldErrors(errors); setError("请检查标出的项目，已填写的内容会保留。");
    requestAnimationFrame(() => { const field=document.getElementById(`listing-${Object.keys(errors)[0]}`); field?.focus({preventScroll:true}); field?.scrollIntoView({block:"center",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"}); });
  }
  async function addFiles(files: FileList | null) {
    if (!files || !editing || saving) return;
    const listingId = editing.id;
    const selected = Array.from(files);
    if (!selected.length) return;
    const entries = selected.map(file => ({ id:crypto.randomUUID(), name:file.name, percent:0, state:"queued" as const }));
    setUploads(entries);
    const update = (id: string, value: Partial<UploadEntry>) => setUploads(current => current.map(item => item.id === id ? {...item,...value} : item));
    let uploaded = 0;
    const failures: string[] = [];
    setSaving(true); setBusyAction("upload"); setError(""); setFieldErrors(current=>({...current,images:""}));
    try {
      for (const [index, file] of selected.entries()) {
        setMessage(`正在上传 ${index + 1}/${selected.length}：${file.name}`);
        try {
          if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) throw new Error("请选择图片或视频文件");
          if (/\.(heic|heif)$/i.test(file.name)) throw new Error("请先在手机中导出为 JPG，或选择 JPEG/PNG 照片，以便客户浏览器正常查看");
          update(entries[index].id,{state:file.type.startsWith('image/')?'compressing':'uploading'});
          const prepared=await prepareListingImage(file);
          const optimization=file.type.startsWith('image/')?(prepared.compressed?`${imageSizeLabel(prepared.originalBytes)} → ${imageSizeLabel(prepared.outputBytes)} · ${prepared.width}×${prepared.height}`:'压缩收益不足，保留原版'):undefined;
          update(entries[index].id,{state:"uploading",optimization});
          const url = await uploadMedia(prepared.file,percent => update(entries[index].id,{percent}));
          update(entries[index].id,{state:"success",percent:100});
          const key = file.type.startsWith("image/") ? "images" : "videos";
          setEditing(current => current?.id === listingId ? { ...current, [key]: [...current[key], url] } : current);
          uploaded++;
        } catch (e) { const detail=e instanceof Error ? e.message : "上传失败，请检查网络"; update(entries[index].id,{state:"error",error:detail}); failures.push(`${file.name}：${detail}`); }
      }
      setMessage(uploaded ? `已上传 ${uploaded} 个文件。请点击“保存草稿”或“发布房源”保存资料。` : "");
      if (failures.length) setError(`以下文件未上传，已成功的文件仍保留在表单中：${failures.join("；")}`);
    }
    finally { setSaving(false); setBusyAction(null); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || saving) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const status = submitter?.value === "published" ? "published" : "draft";
    const errors = listingErrors(editing,status === "published");
    if (Object.keys(errors).length) { validation(errors); return; }
    if (!event.currentTarget.checkValidity()) { event.currentTarget.reportValidity(); return; }
    setFieldErrors({}); setBusyAction(status);
    setSaving(true); setError(""); setMessage("");
    try {
      const saved = await saveListing({ ...editing, unit:editing.unit_split?[editing.building,editing.room].filter(Boolean).join(" ")||null:editing.unit, title: editing.title.trim(), status, withdrawn_at: status === "published" ? null : editing.status === "published" ? new Date().toISOString() : editing.withdrawn_at });
      setItems(current => [saved[0], ...current.filter(item => item.id !== editing.id)]); setEditing(null);
      const codeNote = saved[0].internal_code ? `房源编号：${saved[0].internal_code}。` : '';
      setMessage(status === "published" ? `房源已发布，展示页刷新后可见。${codeNote}` : `草稿已保存，仅管理员可见。${codeNote}`);
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); setBusyAction(null); }
  }
  async function remove(item: LiveListing) {
    if (!window.confirm(`将“${item.title}”移入回收站？房源会停止展示，照片和资料保留，可从回收站恢复。`)) return;
    setSaving(true); setBusyAction("delete"); setError("");
    try { await deleteListing(item.id); setItems(await loadAll()); setEditing(null); setMessage("房源已移入回收站，可随时恢复。"); }
    catch (e) { setError(e instanceof Error ? e.message : "删除失败"); }
    finally { setSaving(false); setBusyAction(null); }
  }
  function logout() { if(hasUnsavedChanges()&&!confirm("有未保存的房源或导入资料，确定退出？"))return; setBulkOpen(false);setBulkDirty(false);signOut(); setAuthorized(false); setRole(null); setItems([]); setInquiries([]); setInquiriesLoaded(false); setEditing(null); setMessage(""); setError(""); }

  return <div className="admin-shell">
    <header className="admin-header"><a href={sitePath("/")}><ArrowLeft size={18}/>返回网站</a><strong>{settings.platform_name} · 管理后台</strong>{authorized && <button disabled={saving} onClick={logout}><LogOut size={17}/>退出</button>}</header>
    {!backendReady ? <main className="admin-center"><div className="admin-panel"><h1>管理后台待开通</h1><p>房源展示页已经可以显示实拍照片。网页内上传和跨设备管理需要先连接数据库与文件存储服务；当前网站尚未配置该服务。</p><p>开通后，此处可以登录并上传照片、视频，填写房源资料，保存草稿或发布。</p></div></main> : checking ? <main className="admin-center"><div className="admin-panel"><p>正在连接管理后台…</p></div></main> : !authorized ? <main className="admin-center"><form className="admin-panel" onSubmit={login} noValidate><h1>管理员登录</h1><p>请用本站已开通的管理员邮箱登录，不能填写 admin，也不能使用 WorkBuddy 的账号密码。</p><label>管理员邮箱<input type="email" required autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="例如 name@qq.com" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>密码<input type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}/></label><button className="admin-primary" type="submit">登录</button>{error && <p className="admin-error" role="alert">{error}</p>}</form></main> : <main className="admin-main">
      <section className="admin-overview"><div className="admin-overview-identity"><div className={`admin-overview-avatar ${role==="superadmin"?"super":""}`}>{role==="superadmin"?"超":"管"}</div><div><h1>{role?adminRoleLabel(role):"管理员"}</h1><span>{role==="superadmin"?"全部管理权限":role==="content_admin"?"全部园区 · 房源与留言":assignedPark}</span><p>{email}</p></div><button className="admin-overview-refresh" disabled={saving||refreshing} onClick={()=>{setError("");void refreshData();}}><RefreshCw size={17} className={refreshing?"feedback-spinner":""}/>{refreshing?"刷新中":"刷新数据"}</button></div><div className="admin-overview-counts"><div><strong>{liveItems.filter(x=>x.status==="published").length}</strong><span>在租房源</span></div><div><strong>{pending}</strong><span>待处理留言</span></div><div><strong>{metrics?metrics.visitors:"—"}</strong><span>{role==="superadmin"?"累计访客":"房源访客"}</span></div></div></section>
      <AdminTabs section={section} pending={pending} disabled={saving} onChange={switchSection}/>
      {inquiriesLoaded&&<InquiryNotifier key={`${email}:${role}:${assignedPark}`} rows={inquiries} onRows={setInquiries} blocked={saving} visible={section==='inquiries'} onOpen={()=>switchSection('inquiries')}/>}
      <div id="admin-section" role="tabpanel" aria-labelledby={`tab-${section}`}>
      {message && <div className={`admin-message ${saving ? "" : "success-note"}`} role="status">{saving ? <LoaderCircle className="feedback-spinner" size={20}/> : <CheckCircle2 className="success-check"/>}<span>{message}</span></div>}{error && !editing && <div className="admin-error" role="alert">{error}</div>}
      {section === "inquiries" ? <InquiryWorkspace items={items} inquiries={inquiries} onRefresh={refreshData}/> : section === "stats" ? <WorkspaceStats items={items} inquiries={inquiries} metrics={metrics} canViewCustomers={role==="superadmin"||role==="content_admin"}/> : section === "parks" ? <ParkWorkspace parks={parks} items={items} isSuper={role==="superadmin"} onRefresh={refreshData}/> : section === "settings" ? <SettingsWorkspace settings={settings} parks={parks} isSuper={role==="superadmin"} onRefresh={refreshData}/> : section === "map" ? <section className="workspace-card workspace-map-placeholder"><MapPin size={36}/><h2>地图标注</h2><p>此处预留自有地图与标注功能。</p><span>暂未导入底图</span></section> : bulkOpen ? <ListingBulkImport parks={parks} assignedPark={assignedPark} parkOnly={role==="park_admin"} onBusy={setSaving} onDirty={setBulkDirty} onClose={()=>{if(bulkDirty&&!confirm("导入预览中还有未保存资料，确定返回列表？"))return;setBulkOpen(false);setBulkDirty(false);}} onRefresh={refreshData}/> : editing ? <form className="admin-editor listing-editor" onSubmit={save} noValidate aria-busy={saving}><div className="admin-editor-heading"><div><h2>{items.some(x=>x.id===editing.id) ? "编辑房源" : "新增房源"}</h2><p>先选择业态，再补充房源资料。资料未齐时可先保存草稿。</p></div><button type="button" disabled={saving} onClick={closeEditor}>返回列表</button></div><fieldset className="admin-fields" disabled={saving}><ListingFields listing={editing} onChange={change} onPark={selectPark} parks={parks} assignedPark={assignedPark} parkOnly={role==="park_admin"} errors={fieldErrors}>
      <div className="admin-upload" id="listing-images" tabIndex={-1}><h3><ImagePlus size={20}/>照片与视频</h3><p>第一张照片作为封面。JPG、PNG、WebP 会自动缩至长边不超过 1600 像素并压缩，压缩收益不足时保留原版；按选择顺序逐张处理。HEIC 请先转为 JPG；视频不自动压缩。上传后仍需保存或发布房源。</p><label className="admin-upload-button"><Upload size={18}/>选择照片或视频<input type="file" accept="image/*,video/*" multiple onChange={e=>{void addFiles(e.target.files);e.target.value="";}} disabled={saving}/></label>{fieldErrors.images && <p className="admin-field-error" role="alert">{fieldErrors.images}</p>}
      {uploads.length > 0 && <div className="upload-queue" aria-label="文件上传进度">{uploads.map(file=><div className={`upload-row ${file.state}`} key={file.id}><div className="upload-row-label"><span title={file.name}>{file.name}</span><small>{file.state === "success" ? "上传成功" : file.state === "error" ? "上传失败" : file.state === "queued" ? "等待上传" : file.state === "compressing" ? "正在压缩…" : file.percent >= 99 ? "云端确认中…" : `${file.percent}%`}</small></div><div className="upload-progress" role="progressbar" aria-label={file.name} aria-valuenow={file.percent} aria-valuemin={0} aria-valuemax={100}><i style={{width:`${file.percent}%`}}/></div>{file.optimization && <p className="workspace-help">{file.optimization}</p>}{file.error && <p className="admin-field-error">{file.error}</p>}</div>)}</div>}
      <p className="admin-media-hint">第一张为封面。电脑可拖动照片排序，也可用箭头调整；手机可点“设为封面”。</p>
      <div className="admin-media-grid">{editing.images.map((url,i)=><div className="admin-media" key={url} data-photo-key={url} draggable={!saving} onDragStart={event=>{draggedPhoto.current=i;event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",String(i));}} onDragEnd={()=>{draggedPhoto.current=null;}} onDragOver={event=>{if(draggedPhoto.current!==null)event.preventDefault();}} onDrop={event=>{event.preventDefault();if(draggedPhoto.current!==null)movePhoto(draggedPhoto.current,i);draggedPhoto.current=null;}}><div className="admin-media-visual media-frame"><img src={url} alt={`房源照片 ${i+1}`} draggable={false}/>{i===0 && <span className="admin-cover-badge">封面</span>}</div><div className="admin-photo-tools"><button type="button" disabled={saving || i===0} onClick={()=>movePhoto(i,i-1)} aria-label={`照片 ${i+1} 前移`}><ChevronLeft size={16}/></button>{i>0 ? <button type="button" disabled={saving} onClick={()=>movePhoto(i,0)}>设为封面</button> : <span>第 1 张</span>}<button type="button" disabled={saving || i===editing.images.length-1} onClick={()=>movePhoto(i,i+1)} aria-label={`照片 ${i+1} 后移`}><ChevronRight size={16}/></button></div><button type="button" onClick={()=>change("images",editing.images.filter((_,index)=>index!==i))}>从房源移除</button></div>)}{editing.videos.map((url,i)=><div className="admin-media" key={url}><video src={url} controls preload="metadata"/><button type="button" onClick={()=>change("videos",editing.videos.filter((_,index)=>index!==i))}>从房源移除</button></div>)}</div></div></ListingFields>
      <div className="admin-actions listing-actions"><span className="admin-state">当前：{editing.status === "published" ? "已发布" : "草稿"}</span><button type="submit" name="action" value="draft" className="admin-secondary" disabled={saving}>{busyAction === "draft" ? <LoaderCircle size={18} className="feedback-spinner"/> : <Save size={18}/>} {busyAction === "draft" ? "保存中…" : editing.status === "published" ? "下架并保存草稿" : "保存草稿"}</button><button type="button" className="admin-secondary" disabled={saving} onClick={()=>setPreviewOpen(true)}>预览房源</button><button className="admin-primary" type="submit" name="action" value="published" disabled={saving}>{busyAction === "published" ? <LoaderCircle size={18} className="feedback-spinner"/> : <Upload size={18}/>} {busyAction === "published" ? "发布中…" : editing.status === "published" ? "保存并发布" : "发布房源"}</button>{items.some(x=>x.id===editing.id) && <button className="admin-danger" type="button" onClick={()=>void remove(editing)} disabled={saving}><Trash2 size={17}/>删除</button>}</div>
      <p className="admin-publish-hint">发布需填写标题、园区、面积、联系人和电话，至少上传 1 张真实照片（当前 {editing.images.length} 张）。资料未齐时可先保存草稿；点击“发布房源”后，客户才可在展示页看到。</p></fieldset>
      {error && <div className="admin-error" role="alert">{error}</div>}
      {previewOpen&&<ListingPreview listing={editing} onClose={()=>setPreviewOpen(false)}/>}</form> : <div className="workspace-stack"><div className="workspace-toolbar listing-toolbar"><label className="workspace-search"><Search size={18}/><input aria-label="搜索房源" placeholder="搜索园区 / 楼栋 / 房源编号" value={keyword} onChange={e=>{setKeyword(e.target.value);if(listingCode(e.target.value)){setStatusFilter("all");setParkFilter("");}}}/></label><button disabled={saving} className="admin-secondary" onClick={()=>{setBulkOpen(true);setError("");setMessage("");}}>批量导入</button><button className="admin-primary" disabled={saving} onClick={startNew}><Plus size={18}/>新增房源</button></div><div className="workspace-list-filters"><div className="workspace-chips">{[["all",`全部 ${liveItems.length}`],["published",`在租 ${liveItems.filter(x=>x.status==="published").length}`],["draft",`草稿 ${liveItems.filter(x=>x.status==="draft"&&!x.withdrawn_at).length}`],["offline",`已下架 ${liveItems.filter(x=>x.status==="draft"&&x.withdrawn_at).length}`],["trash","回收站"]].map(([value,label])=><button key={value} disabled={saving} className={statusFilter===value?"active":""} aria-pressed={statusFilter===value} onClick={()=>setStatusFilter(value)}>{label}</button>)}</div><label className="workspace-park-filter"><span className="sr-only">按园区筛选</span><select value={parkFilter} onChange={e=>setParkFilter(e.target.value)}><option value="">全部园区</option>{Array.from(new Set(items.map(x=>x.park).filter(Boolean))).map(name=><option key={name} value={name!}>{name}</option>)}</select></label><button className="admin-secondary" disabled={saving||refreshing} title="按当前筛选条件导出园区、系统房号、园区房号等核对字段" onClick={()=>void exportListings()}>{saving?<LoaderCircle size={16} className="feedback-spinner"/>:<Download size={16}/>}导出 CSV</button></div><div className="workspace-listing-grid">{visibleItems.length===0 ? <div className="workspace-card admin-empty">当前条件下没有房源。可以调整筛选，或点击“新增房源”上传。</div> : visibleItems.map(item=><article className="workspace-listing" key={item.id}><button className="workspace-listing-photo" aria-label={`编辑 ${item.title}`} disabled={saving} onClick={()=>{setEditing({...item});setUploads([]);setFieldErrors({});setMessage("");setError("");}}>{item.images[0]?<img src={item.images[0]} alt={item.title}/>:<span>暂无照片</span>}</button><div className="workspace-listing-body"><button className="workspace-listing-title" disabled={saving} onClick={()=>{setEditing({...item});setUploads([]);setFieldErrors({});setMessage("");setError("");}}>{item.title||"未命名草稿"}</button><p className="workspace-listing-code">房源编号：{item.internal_code||"保存后生成"}</p><p>{item.park||"园区待补充"} · {item.floor||"楼层待补充"} · {item.area===null?"面积待补充":`${item.area}㎡`}</p><p>{[item.facing,item.decoration,item.layout].filter(Boolean).join(" · ")}</p><strong className="workspace-listing-price">{item.price===null?"租金面议":`${item.price} 元/㎡·月`}{item.fee!==null&&<small> · 物业 {item.fee} 元</small>}</strong><div className="workspace-actions"><span className={`workspace-status ${item.status==="published"?"replied":"neutral"}`}>{item.deleted_at?"回收站":item.status==="published"?"在租中":item.withdrawn_at?"已下架":"草稿"}</span>{item.deleted_at?<button disabled={saving} className="workspace-op" onClick={()=>void changeListingStatus(item,true)}>恢复为草稿</button>:<><button disabled={saving} className="workspace-op neutral" onClick={()=>void changeListingStatus(item)}>{item.status==="published"?"下架":"发布"}</button><button disabled={saving} className="workspace-op" onClick={()=>{setEditing({...item});setUploads([]);setFieldErrors({});setMessage("");setError("");}}>编辑</button><button disabled={saving} className="workspace-op danger" onClick={()=>void remove(item)}>删除</button></>}</div></div></article>)}</div></div>}
      </div>
    </main>}
  </div>;
}
