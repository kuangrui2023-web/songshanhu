'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, CheckCircle2, X, LoaderCircle } from 'lucide-react';
import type { LiveListing } from '@/lib/backend';
import { uploadMedia } from '@/lib/backend';
import { importListingNote, type Park } from '@/lib/admin-workspace';
import { readImaZip, type ImportedPackage } from '@/lib/ima-zip';
import { identityIssues, importIssues, propertyKey, type NoteIssue } from '@/lib/listing-import';
import { prepareListingImage } from '@/lib/image-upload';
import { executeNoteImport, type ImportResult } from '@/lib/listing-import-runner';
import { ListingFields, ListingPreview } from './listing-fields';
import { sitePath } from '@/lib/site-path';

type Entry=ImportedPackage&{selected:boolean;check?:ImportResult;uploaded:string[];progress:string;error:string;done?:ImportResult};
type Props={parks:Park[];assignedPark:string|null;parkOnly:boolean;onBusy:(busy:boolean)=>void;onDirty:(dirty:boolean)=>void;onClose:()=>void;onRefresh:()=>Promise<void>};
const detail=(e:unknown)=>e instanceof Error?e.message:'操作未完成，请重试。';
export function ListingBulkImport({parks,assignedPark,parkOnly,onBusy,onDirty,onClose,onRefresh}:Props){
 const [entries,setEntries]=useState<Entry[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reviewed,setReviewed]=useState(false),[editing,setEditing]=useState<string|null>(null),[preview,setPreview]=useState<LiveListing|null>(null);
 const urls=useRef<string[]>([]),pending=useRef(false),dialog=useRef<HTMLDialogElement>(null);
 const dirty=entries.some(e=>!e.done);
 useEffect(()=>{onDirty(dirty);return()=>onDirty(false);},[dirty,onDirty]);
 useEffect(()=>()=>{urls.current.forEach(u=>URL.revokeObjectURL(u));},[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
 useEffect(()=>{if(editing&&!dialog.current?.open)dialog.current?.showModal();},[editing]);
 const update=(id:string,patch:Partial<Entry>)=>setEntries(current=>current.map(e=>e.listing.id===id?{...e,...patch}:e));
 function lock(value:boolean){pending.current=value;setBusy(value);onBusy(value);}
 async function checkRows(rows:Entry[]){
  const seen=new Set<string>();
  for(const e of rows){
   if(e.done)continue;
   const key=propertyKey(e.listing);
   if(identityIssues(e.listing).length||e.issues.length){update(e.listing.id,{check:undefined});continue;}
   if(seen.has(key)){update(e.listing.id,{selected:false,check:{status:'duplicate',message:'本批次内同一园区、楼栋和房号重复，请仅保留一份。'}});continue;}seen.add(key);
   update(e.listing.id,{progress:'正在查重',error:''});
   try{const check=await importListingNote({...e.listing,images:[]});update(e.listing.id,{check,done:check.status==='saved'?check:undefined,selected:check.status==='new',progress:'',error:''});}
   catch(ex){update(e.listing.id,{selected:false,check:undefined,progress:'',error:detail(ex)});}
  }
 }
 async function choose(files:FileList|null){
  if(!files?.length||pending.current)return;
  if(entries.length&&!confirm('重新选择将清空本页未保存的导入预览，已保存房源仍保留。确定继续？'))return;
  const selected=Array.from(files);setError('');setNotice('');
  if(selected.length>20||selected.reduce((n,f)=>n+f.size,0)>100*1024*1024){setError('每批最多20个 ZIP、合计100MB；手机建议每次5～10套。');return;}
  lock(true);setReviewed(false);setEntries([]);setEditing(null);urls.current.forEach(u=>URL.revokeObjectURL(u));urls.current=[];
  const rows:Entry[]=[];const failures:string[]=[];
  try{
   for(const f of selected){
    try{
     if(!/\.zip$/i.test(f.name))throw new Error('请选择 ima 导出的 ZIP，不是 PDF 或截图。');
     const packages=await readImaZip(f);
     if(rows.length+packages.length>20)throw new Error('每批最多20套房源，请分批选择。');
     for(const item of packages){
      const images=item.photos.map(photo=>{const url=URL.createObjectURL(photo);urls.current.push(url);return url;});
      if(parkOnly&&item.listing.park!==assignedPark)item.issues.push({field:'park',message:'笔记园区与当前账号管理范围不一致。'});
      rows.push({...item,listing:{...item.listing,images},selected:false,uploaded:[],progress:'',error:''});
     }
    }catch(e){failures.push(`${f.name}：${detail(e)}`);}
   }
   setEntries(rows);if(failures.length)setError(failures.join('\n'));
   await checkRows(rows);
  }finally{lock(false);}
 }
 async function recheck(){if(pending.current)return;lock(true);setReviewed(false);try{await checkRows(entries);}finally{lock(false);}}
 async function run(mode:'draft'|'published'){
  if(pending.current)return;
  const rows=entries.filter(e=>e.selected&&!e.done);
  if(!rows.length){setError('请先选择要保存的房源。');return;}
  if(mode==='published'&&!reviewed){setError('请先核对公开内容、费用和照片，并勾选下方确认项。');return;}
  const invalid=rows.find(e=>e.issues.length||importIssues(e.listing,mode==='published').length||e.check?.status!=='new');
  if(invalid){setError('选中资料仍有错误或尚未完成查重，请先编辑或取消选择。');return;}
  if(mode==='published'&&!confirm(`确认发布选中的 ${rows.length} 套房源？发布后客户可查看公开字段及照片。`))return;
  lock(true);setError('');setNotice('');
  let success=0,failed=0;
  try{
   for(const e of rows){
    try{
     const result=await executeNoteImport(e.listing,e.photos,e.uploaded,mode,{
      check:listing=>importListingNote(listing),prepare:async file=>(await prepareListingImage(file)).file,upload:uploadMedia,save:importListingNote
     },uploaded=>update(e.listing.id,{uploaded}),progress=>update(e.listing.id,{progress,error:''}));
     update(e.listing.id,{done:result,check:result,selected:false,progress:'',error:''});success++;
    }catch(ex){update(e.listing.id,{progress:'',error:detail(ex)});failed++;}
   }
   setNotice(`已确认保存 ${success} 套${failed?`，${failed} 套未完成。已上传照片和导入编号保留在本页，可重试失败项。`:'。请查看每条的草稿／已发布状态，可在房源列表继续编辑。'}`);
   try{await onRefresh();}catch{setNotice(n=>n+' 房源列表刷新失败，请稍后手动刷新，不要重复导入。');}
  }finally{lock(false);}
 }
 const active=entries.find(e=>e.listing.id===editing);
 const eligible=entries.filter(e=>!e.done&&e.check?.status==='new'&&!e.issues.length);
 const selectedCount=entries.filter(e=>e.selected&&!e.done).length;
 function editChange<K extends keyof LiveListing>(key:K,value:LiveListing[K]){
  if(!active||busy)return;setReviewed(false);
  if((key==='title'||key==='category')&&value==null)value='' as LiveListing[K];
  const id=active.listing.id;setEntries(rows=>rows.map(e=>e.listing.id===id?{...e,listing:{...e.listing,[key]:value},issues:e.issues.filter(i=>i.field!==key),check:undefined,selected:false,error:''}:e));
 }
 return <section className="bulk-import workspace-card" aria-labelledby="bulk-title">
  <header className="bulk-heading"><div><p className="bulk-eyebrow">IMA 笔记导入</p><h2 id="bulk-title">批量导入房源</h2><p>选择导出包，核对资料，再保存或发布。固定字段在本机读取，不调用 AI。</p></div><button type="button" className="admin-secondary" disabled={busy} onClick={onClose}>返回房源列表</button></header>
  <ol className="bulk-steps"><li>选择 ZIP</li><li>读取与查重</li><li>核对资料和照片</li><li>保存或发布</li></ol>
  <div className="bulk-pick"><Upload size={26}/><div><strong>直接选择 ima 导出的 ZIP，可一次选择多个</strong><p>每套一份 Markdown/TXT 和对应照片；图片按笔记引用顺序排列，第一张作封面。照片支持 JPG、PNG、WebP，上传时自动压缩。</p><small>每批最多20套、合计100MB；手机建议每次5～10套。上传期间请保持页面打开。暂不读取分享卡片、PDF、外部图片链接或视频。</small></div><label className="admin-upload-button">{busy?<LoaderCircle className="feedback-spinner" size={18}/>:<Upload size={18}/>}选择 ima ZIP<input type="file" accept=".zip,application/zip" multiple disabled={busy} onChange={e=>{void choose(e.target.files);e.target.value='';}}/></label></div>
  <details className="bulk-template"><summary>查看笔记字段格式</summary><p>沿用你们现有笔记：“所属片区：”“园区名称：”“楼栋：”“楼层：”“房号：”“面积：”“租金单价：”“物业费单价：”“业主底价：”“招商：”“招商电话：”等。每套一份，不在标题中公开园区或房号。租金、物业费和业主底价单位为元/㎡·月，未知留空。房源类型可增加“房源类型：厂房”；未写时暂按写字楼读取，需核对。</p></details>
  {error&&<p className="admin-error" role="alert" style={{whiteSpace:'pre-wrap'}}>{error}</p>}{notice&&<p className="admin-message" role="status">{notice}</p>}
  {!!entries.length&&<><div className="bulk-toolbar"><label><input type="checkbox" disabled={busy||!eligible.length} checked={eligible.length>0&&eligible.every(e=>e.selected)} onChange={e=>{const value=e.target.checked;setEntries(rows=>rows.map(row=>eligible.some(x=>x.listing.id===row.listing.id)?{...row,selected:value}:row));}}/>选择可导入项</label><span>共 {entries.length} 套 · 已选 {selectedCount} 套</span><button className="admin-secondary" disabled={busy} onClick={()=>void recheck()}>重新查重</button></div>
   <div className="bulk-entries">{entries.map((e,index)=>{
    const publishIssues:NoteIssue[]=importIssues(e.listing,true),problems=[...e.issues,...publishIssues];
    const blocked=e.check?.status==='duplicate'||e.check?.status==='review';
    return <article className={`bulk-entry ${e.done?'is-done':blocked?'is-blocked':''}`} key={e.listing.id}>
     <header><label><input type="checkbox" aria-label={`选择第${index+1}套房源`} disabled={busy||!!e.done||blocked||e.issues.length>0||e.check?.status!=='new'} checked={e.selected} onChange={ev=>update(e.listing.id,{selected:ev.target.checked})}/><strong>{e.listing.title||'标题待补充'}</strong></label><span className="bulk-status">{e.done?'已保存':e.progress|| (blocked?'需核对重复':e.error?'未完成':!e.check?'待查重':problems.length?'需补充':'可导入')}</span></header>
     <div className="bulk-entry-body"><div className="bulk-photo-strip">{e.listing.images.map((src,i)=><figure key={src}><img src={src} alt={`第${index+1}套照片${i+1}`} loading="lazy"/><figcaption>{i===0?'封面':`照片 ${i+1}`}</figcaption></figure>)}</div><div className="bulk-info"><p>{e.listing.park||'园区待填'} · {e.listing.building||'楼栋待填'} · {e.listing.floor||'楼层待填'} · {e.listing.room||'房号待填'} <small>仅后台位置资料</small></p><p>{e.listing.area??'—'}㎡ · 租金 {e.listing.price??'面议'} · 物业 {e.listing.fee??'待确认'} 元/㎡·月 · {e.photos.length} 张照片</p><small>{e.source}</small>
      {!e.done&&e.warnings.map(w=><p className="bulk-warning" key={w}>{w}</p>)}
      {!e.done&&problems.length>0&&<ul className="bulk-issues">{[...new Set(problems.map(i=>i.message))].map(m=><li key={m}>{m}</li>)}</ul>}
      {blocked&&<p className="admin-error">{e.check?.message}{e.check?.code&&` 房源编号：${e.check.code}`}</p>}
      {e.error&&<p className="admin-error" role="alert">{e.error}</p>}{e.progress&&<p role="status"><LoaderCircle className="feedback-spinner" size={14}/>{e.progress}</p>}
      {e.done&&<p className="bulk-success"><CheckCircle2 size={16}/>房源编号 {e.done.code||'已生成'} · {e.done.mode==='published'?'已发布':'草稿'} {e.done.id&&<a href={sitePath(`/experience/?id=${encodeURIComponent(e.done.id)}`)} target="_blank" rel="noopener noreferrer">{e.done.mode==='published'?'查看房源 ↗':''}</a>}</p>}
     </div></div>
     <footer><span>{e.photos.length?'请核对照片、水印与顺序，避免公开内部资料。':'未匹配到照片，可先保存草稿。'}</span><div><button className="admin-secondary" disabled={busy||!!e.done} onClick={()=>setEditing(e.listing.id)}>编辑资料</button><button className="admin-secondary" disabled={busy} onClick={()=>setPreview(e.listing)}>客户视角预览</button></div></footer>
    </article>;
   })}</div>
   <div className="bulk-submit"><label><input type="checkbox" checked={reviewed} disabled={busy} onChange={e=>setReviewed(e.target.checked)}/>我已核对选中房源的费用、公开文案与照片；业主底价、内部位置和房源联系人仅后台保存。</label><div><span>选中 {selectedCount} 套</span><button className="admin-secondary" disabled={busy||!selectedCount} onClick={()=>void run('draft')}>保存选中草稿</button><button className="admin-primary" disabled={busy||!selectedCount||!reviewed} onClick={()=>void run('published')}>{busy?'处理中…':'发布选中房源'}</button></div><small>已保存的记录不会再次导入或自动覆盖；如需修改，请在原房源编辑。未完成上传的照片和重试状态仅保留在本页，离开前请处理完成。</small></div>
  </>}
  {active&&<dialog ref={dialog} className="bulk-edit-dialog" onClose={()=>setEditing(null)}><header><h2>核对导入资料</h2><button aria-label="关闭资料编辑" onClick={()=>dialog.current?.close()}><X/></button></header><ListingFields listing={active.listing} onChange={editChange} onPark={name=>editChange('park',name)} parks={parks} assignedPark={assignedPark} parkOnly={parkOnly} errors={Object.fromEntries(active.issues.filter(i=>i.field).map(i=>[i.field!,i.message]))}><p>照片按导出笔记顺序匹配；若要更改图片内容或顺序，请先在 ima 修改并重新导出。</p></ListingFields><footer><button className="admin-primary" onClick={()=>{dialog.current?.close();void recheck();}}>完成编辑并重新查重</button></footer></dialog>}
  {preview&&<ListingPreview listing={preview} onClose={()=>setPreview(null)}/>}
 </section>;
}
