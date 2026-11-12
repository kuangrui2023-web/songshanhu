import type { LiveListing } from './backend';
export type ImportResult={status:'new'|'duplicate'|'review'|'saved';id?:string;code?:string;mode?:string;message?:string};
export type ImportServices={check:(listing:LiveListing)=>Promise<ImportResult>;prepare:(photo:File)=>Promise<File>;upload:(file:File)=>Promise<string>;save:(listing:LiveListing,mode:'draft'|'published')=>Promise<ImportResult>};
export async function executeNoteImport(listing:LiveListing,photos:File[],uploaded:string[],mode:'draft'|'published',services:ImportServices,onUploaded:(urls:string[])=>void,onProgress:(text:string)=>void){
 onProgress('正在核对云端重复记录');const check=await services.check({...listing,images:uploaded});
 if(check.status==='saved')return check;
 if(check.status!=='new')throw new Error(check.message||'该房源需要先核对重复记录。');
 const urls=[...uploaded];
 for(let i=urls.length;i<photos.length;i++){
  onProgress(`正在压缩照片 ${i+1}/${photos.length}`);const file=await services.prepare(photos[i]);
  onProgress(`正在上传照片 ${i+1}/${photos.length}`);urls.push(await services.upload(file));onUploaded([...urls]);
 }
 onProgress(mode==='published'?'正在发布房源':'正在保存草稿');
 const result=await services.save({...listing,images:urls},mode);
 if(result.status!=='saved')throw new Error(result.message||'保存前发现重复房源，请核对。');
 return result;
}
