export type PreparedImage={file:File;originalBytes:number;outputBytes:number;width?:number;height?:number;compressed:boolean};
const supported=new Set(['image/jpeg','image/png','image/webp']);

function encode(canvas:HTMLCanvasElement,type:string,quality:number):Promise<Blob>{
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('图片压缩失败，请换一张照片或重试。')),type,quality));
}

/** Prepare one image at a time; never send the original alongside the result. */
export async function prepareListingImage(file:File):Promise<PreparedImage>{
  const unchanged={file,originalBytes:file.size,outputBytes:file.size,compressed:false};
  if(!file.type.startsWith('image/'))return unchanged;
  if(!supported.has(file.type)||/\.(heic|heif)$/i.test(file.name))throw new Error('房源照片请使用 JPG、PNG 或 WebP；HEIC 请先转为 JPG。');
  if(file.size>40*1024*1024)throw new Error('单张照片超过 40MB，请先缩小后上传。');
  const url=URL.createObjectURL(file),image=new Image();
  let canvas:HTMLCanvasElement|undefined;
  try{
    image.src=url;
    // Browser decoding applies the photo's EXIF orientation before drawing.
    try{await image.decode();}catch{throw new Error('照片无法读取，请确认图片未损坏，或重新导出为 JPG。');}
    const width=image.naturalWidth,height=image.naturalHeight;
    if(!width||!height||width*height>60000000)throw new Error('照片尺寸过大或无效，请先缩小后上传。');
    const ratio=Math.min(1,1600/Math.max(width,height));
    const targetWidth=Math.max(1,Math.round(width*ratio)),targetHeight=Math.max(1,Math.round(height*ratio));
    canvas=document.createElement('canvas');canvas.width=targetWidth;canvas.height=targetHeight;
    const context=canvas.getContext('2d');
    if(!context)throw new Error('浏览器无法压缩照片，请使用较新的系统浏览器重试。');
    context.drawImage(image,0,0,targetWidth,targetHeight);
    let blob=await encode(canvas,'image/webp',.86),extension='webp';
    if(blob.type!=='image/webp'){
      // Older encoders may return PNG when WebP encoding is unsupported.
      context.globalCompositeOperation='destination-over';context.fillStyle='#fff';context.fillRect(0,0,targetWidth,targetHeight);
      blob=await encode(canvas,'image/jpeg',.88);extension='jpg';
      if(blob.type!=='image/jpeg')throw new Error('浏览器不支持照片压缩，请更换系统浏览器后重试。');
    }
    if(blob.size>=file.size*.95)return {...unchanged,width,height};
    const name=(file.name.replace(/\.[^.]*$/,'')||'房源照片')+'.'+extension;
    const output=new File([blob],name,{type:blob.type,lastModified:file.lastModified});
    return {file:output,originalBytes:file.size,outputBytes:output.size,width:targetWidth,height:targetHeight,compressed:true};
  }finally{URL.revokeObjectURL(url);image.src='';if(canvas){canvas.width=0;canvas.height=0;}}
}

export function imageSizeLabel(bytes:number){return bytes>=1024*1024?`${(bytes/1024/1024).toFixed(2)}MB`:`${Math.max(1,Math.round(bytes/1024))}KB`;}
