import { Unzip, UnzipInflate } from 'fflate';
import { parseListingNote, type ParsedNote } from './listing-import';
export type ImportedPackage=ParsedNote&{source:string;photos:File[]};
const MB=1024*1024;
function safePath(path:string){
 if(!path||path.startsWith('/')||path.includes('\\')||/^[A-Za-z]:/.test(path)||path.split('/').some(p=>p==='..'||p==='.'||!p))throw new Error('ZIP 中存在不安全或无效的文件路径，请重新导出。');return path;
}
function resolveImage(note:string,ref:string){
 let path:string;try{path=decodeURIComponent(ref);}catch{throw new Error('笔记中的图片路径编码不正确。');}
 if(/^[a-z][a-z0-9+.-]*:/i.test(path)||path.startsWith('//')||path.includes('?')||path.includes('#'))throw new Error('请导出包含本地图片的 ZIP；不读取外部图片链接。');
 path=path.replace(/^\.\//,'');const dir=note.includes('/')?note.slice(0,note.lastIndexOf('/')+1):'';return safePath(dir+path);
}
export async function readImaZip(file:File):Promise<ImportedPackage[]>{
 if(file.size>60*MB)throw new Error(`${file.name} 超过60MB，请拆分后上传。`);
 const data=new Uint8Array(await file.arrayBuffer()),files=new Map<string,Uint8Array>();let size=0,count=0,failure:Error|undefined;
 const unzip=new Unzip(entry=>{
  try{
   if(entry.name.endsWith('/')||entry.name.startsWith('__MACOSX/')||entry.name.split('/').pop()?.startsWith('.'))return;
   const path=safePath(entry.name);if(++count>250)throw new Error('单个 ZIP 文件过多，请分批上传。');
   if(files.has(path))throw new Error('ZIP 内有重复文件路径，请重新导出。');
   if(!/\.(md|txt|jpe?g|png|webp)$/i.test(path))throw new Error(`不支持 ${path.split('/').pop()}，请使用 Markdown/TXT 和 JPG/PNG/WebP。`);
   if((entry.originalSize||0)>40*MB)throw new Error('单个文件超过40MB。');
   const chunks:Uint8Array[]=[];let length=0;files.set(path,new Uint8Array());
   entry.ondata=(error,chunk,final)=>{
    if(error){failure=new Error('ZIP 图片解压失败，请重新导出。');entry.terminate();return;}
    if(failure){entry.terminate();return;}length+=chunk.length;size+=chunk.length;
    if(length>40*MB||size>120*MB){failure=new Error('解压后资料超过120MB，请分批导入。');entry.terminate();return;}
    chunks.push(chunk);if(final){const buffer=new Uint8Array(length);let p=0;for(const c of chunks){buffer.set(c,p);p+=c.length;}files.set(path,buffer);}
   };entry.start();
  }catch(e){failure=e instanceof Error?e:new Error('ZIP 无法读取。');entry.terminate();}
 });unzip.register(UnzipInflate);
 try{for(let i=0;i<data.length&&!failure;i+=65536)unzip.push(data.subarray(i,Math.min(data.length,i+65536)),i+65536>=data.length);}catch{throw new Error('ZIP 已损坏、加密或格式不支持，请从 ima 重新导出。');}
 if(failure)throw failure;
 const notes=[...files.keys()].filter(p=>/\.(md|txt)$/i.test(p));if(!notes.length||notes.length>20)throw new Error('每个 ZIP 需要1～20份 Markdown/TXT 笔记，每套房源一份。');
 const result:ImportedPackage[]=[];
 for(const path of notes){
  const bytes=files.get(path)!;if(bytes.length>64000)throw new Error('单份笔记超过64KB，请只保留房源资料。');
  let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('笔记需要 UTF-8 编码，请从 ima 重新导出 Markdown。');}
  const parsed=parseListingNote(raw,crypto.randomUUID());
  let images:string[]=[];
  try{
   if(parsed.imagePaths.length)images=parsed.imagePaths.map(ref=>resolveImage(path,ref));
   else{
    const dir=path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
    if(notes.filter(n=>(n.includes('/')?n.slice(0,n.lastIndexOf('/')+1):'')===dir).length>1)throw new Error('同一目录有多份笔记且没有图片引用，无法确定照片归属。');
    images=[...files.keys()].filter(p=>/\.(jpe?g|png|webp)$/i.test(p)&&(p.slice(0,p.lastIndexOf('/')+1)===dir||p.slice(0,p.lastIndexOf('/')+1)===dir+'attachment/')).sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
   }
   if(new Set(images).size!==images.length)throw new Error('笔记重复引用同一张照片，请核对图片顺序。');
   if(images.length>20)throw new Error('每套最多20张照片，请精简后上传。');
   if(images.some(p=>!files.has(p)))throw new Error('笔记引用的图片不在 ZIP 内，请重新导出完整资料。');
  }catch(e){parsed.issues.push({message:e instanceof Error?e.message:'图片无法匹配。'});images=[];}
  const photos=images.map(p=>new File([files.get(p)!.slice().buffer],p.split('/').pop()!,{type:/\.png$/i.test(p)?'image/png':/\.webp$/i.test(p)?'image/webp':'image/jpeg'}));
  result.push({...parsed,source:`${file.name} / ${path}`,photos});
 }
 return result;
}
