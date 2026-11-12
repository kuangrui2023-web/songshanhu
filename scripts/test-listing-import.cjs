const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,f);
const {parseListingNote,propertyKey,importIssues,publicImportIssues}=require('../lib/listing-import.ts');
const {readImaZip}=require('../lib/ima-zip.ts'),{executeNoteImport}=require('../lib/listing-import-runner.ts'),{zipSync,strToU8}=require('fflate');
const note=`# 私有园区713室\n所属片区：松山湖北部\n园区名称：测试园区\n楼栋：1栋\n楼层：7楼\n房号：713室\n租金单价：32\n物业费单价：6\n业主底价：23\n支付方式：押二付一\n免租期：2个月\n面积：100平\n朝向：\n格局：2➕1\n装修：简装\n房源说明：\n招商：测试顾问\n招商电话：01000000000\n微信：test\n视频号：test\n房源联系人：内部测试联系人\n房源联系人电话：01000000001\n![](attachment/2.webp)\n![](attachment/1.webp)`;
(async()=>{
 const parsed=parseListingNote(note,crypto.randomUUID()),l=parsed.listing;
 assert.equal(parsed.issues.length,0);assert.equal(l.region,'北部');assert.equal(l.area,100);assert.equal(l.price,32);assert.equal(l.fee,6);assert.equal(l.owner_floor_price,23);assert.equal(l.layout,'2+1');assert.ok(!l.title.includes('测试园区'));assert.ok(!l.title.includes('713'));assert.equal(l.owner_contact_phone,'01000000001');assert.equal(l.contact_phone,'01000000000');assert.equal(l.field_visibility.room,false);
 assert.equal(propertyKey(l),propertyKey({...l,building:'１',room:'７１３'}));
 assert.ok(parseListingNote(note.replace('32','32元/月'),l.id).issues.some(e=>e.field==='price'),'ambiguous monthly price must not parse as unit price');
 assert.ok(parseListingNote(note+'\n面积：200',l.id).issues.some(e=>e.field==='area'));
 assert.ok(publicImportIssues({...l,description:'请联系01000000001'}).length);
 const pack=zipSync({'笔记.md':strToU8(note),'attachment/1.webp':new Uint8Array([1]),'attachment/2.webp':new Uint8Array([2])});
 let rows=await readImaZip(new File([pack],'test.zip'));assert.equal(rows.length,1);assert.equal(rows[0].photos[0].name,'2.webp');assert.equal(rows[0].photos[1].name,'1.webp');
 assert.ok(!importIssues({...rows[0].listing,images:['local-one']},true).length);
 await assert.rejects(()=>readImaZip(new File([zipSync({'../bad.md':strToU8(note)})],'bad.zip')),/路径/);
 rows=await readImaZip(new File([zipSync({'笔记.md':strToU8(note.replace('attachment/2.webp','https://example.invalid/private.webp')),'attachment/1.webp':new Uint8Array([1])})],'external.zip'));assert.ok(rows[0].issues.some(e=>e.message.includes('外部')));
 rows=await readImaZip(new File([zipSync({'笔记.md':strToU8(note)})],'missing.zip'));assert.ok(rows[0].issues.some(e=>e.message.includes('不在')));
 let uploaded=[],uploads=0,saveCalls=0,fail=true;
 const files=[new File(['x'],'1.jpg'),new File(['y'],'2.jpg')];
 const services={check:async()=>({status:'new'}),prepare:async f=>f,upload:async f=>{uploads++;if(f.name==='2.jpg'&&fail)throw Error('network');return 'url-'+f.name},save:async()=>{saveCalls++;return {status:'saved',code:'123456'}}};
 await assert.rejects(()=>executeNoteImport(l,files,uploaded,'published',services,u=>uploaded=u,()=>{}),/network/);assert.equal(uploaded.length,1);assert.equal(saveCalls,0);
 fail=false;await executeNoteImport(l,files,uploaded,'published',services,u=>uploaded=u,()=>{});assert.equal(uploads,3,'retry reuses first uploaded photo');assert.equal(saveCalls,1);
 const before=uploads;await assert.rejects(()=>executeNoteImport(l,files,[],'published',{...services,check:async()=>({status:'duplicate',message:'duplicate'})},()=>{},()=>{}),/duplicate/);assert.equal(uploads,before);
 const actual=process.env.IMA_SAMPLE;
 if(actual){const p=await readImaZip(new File([fs.readFileSync(actual)],path.basename(actual)));assert.equal(p.length,1);assert.equal(p[0].photos.length,2);assert.equal(p[0].listing.area,100);assert.equal(p[0].issues.length,0);console.log('PASS: actual ima ZIP -> one note, two referenced photos, no parser errors.');}
 console.log('PASS: fixed fields, private/public split, units, fullwidth identity, image order, unsafe paths, external links, missing photos, duplicate no-upload, partial upload retry.');
})().catch(e=>{console.error(e);process.exitCode=1});
