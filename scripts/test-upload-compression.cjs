const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('lib/image-upload.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function setup(options={}){
 const state={draw:[],encodings:[],revoked:0,canvases:0},out={};
 class Image{naturalWidth=options.width||4000;naturalHeight=options.height||3000;decode(){return options.broken?Promise.reject(new Error('decode')):Promise.resolve();}}
 const canvas={width:0,height:0,getContext:()=>({drawImage:(...args)=>state.draw.push(args),fillRect:()=>{}}),toBlob:(callback,type)=>{state.encodings.push(type);callback(new Blob([new Uint8Array(options.output||50000)],{type:options.fallback&&type==='image/webp'?'image/png':type}));}};
 vm.runInNewContext(code,{exports:out,Set,File,Blob,Image,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:()=>state.revoked++},document:{createElement:()=>{state.canvases++;return canvas;}}});
 return {prepare:out.prepareListingImage,state,canvas};
}
const file=(name,type,size=500000)=>new File([new Uint8Array(size)],name,{type});
(async()=>{
 let t=setup(),original=file('房源.JPG','image/jpeg'),r=await t.prepare(original);
 assert.equal(r.file.type,'image/webp');assert.equal(r.file.name,'房源.webp');assert.equal(r.width,1600);assert.equal(r.height,1200);assert.equal(r.compressed,true);assert.equal(r.originalBytes,500000);assert.equal(r.outputBytes,50000);assert.equal(t.state.revoked,1);assert.equal(t.canvas.width,0);
 t=setup({width:800,height:600,output:1000});r=await t.prepare(file('small.png','image/png',500));assert.equal(r.compressed,false);assert.equal(r.file.size,500);assert.equal(t.state.draw[0][3],800,'small images not enlarged');
 t=setup({fallback:true});r=await t.prepare(original);assert.equal(r.file.type,'image/jpeg');assert.equal(r.file.name,'房源.jpg');assert.equal(t.state.encodings.join(','),'image/webp,image/jpeg');
 t=setup();const video=file('sample.mp4','video/mp4');assert.equal((await t.prepare(video)).file,video);assert.equal(t.state.canvases,0);
 await assert.rejects(t.prepare(file('photo.heic','image/heic')));await assert.rejects(t.prepare(file('bad.svg','image/svg+xml')));
 t=setup({broken:true});await assert.rejects(t.prepare(original),/无法读取/);assert.equal(t.state.revoked,1);
 t=setup({width:10000,height:10000});await assert.rejects(t.prepare(original),/尺寸过大/);assert.equal(t.state.revoked,1);
 console.log('PASS image dimensions, MIME/extension, smaller-only replacement, JPEG fallback, videos unchanged, invalid formats and decode failure cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
