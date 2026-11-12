const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path');
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const requireLocal=id=>id.startsWith('.')?load(path.join(path.dirname(file),id+'.ts')):require(id);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:requireLocal,Intl,Date,Map,Set});return exports;}
const api=load('lib/inquiries.ts');
const listing={id:'listing',title:'办公室',internal_code:'100001',owner_contact_name:'OWNER_SECRET',owner_contact_phone:'OWNER_PHONE'};
const item={id:'old',listing_id:'listing',contact:'客户甲',phone:'18600000000',company:'示例企业',request_text:'=HYPERLINK("bad")',created_at:'2026-10-21T16:00:00Z',status:'pending',reply:'',receipt:'PRIVATE_RECEIPT',client_request_id:'PRIVATE_REQUEST'};
assert.equal(api.beijingDate(item.created_at,true),'2026-10-22');assert.equal(api.beijingDate('bad'),'');
assert.equal(api.matchesInquiry(item,listing,'编号：１００００１','2026-10-22','2026-10-22'),true);
assert.equal(api.matchesInquiry(item,listing,'','2026-10-23',''),false);
assert.equal(api.matchesInquiry(item,listing,'办公室','',''),true);
assert.equal(api.matchesInquiry(item,listing,'100002','',''),false);
const incoming=[item,{...item,id:'new'},{...item,id:'closed',status:'closed'},{...item,id:'withdrawn',visitor_withdrawn_at:item.created_at},{...item,id:'trash',deleted_at:item.created_at}];
assert.equal(api.newPendingInquiryIds(incoming,new Set(['old'])).join(','),'new');
assert.equal(api.newPendingInquiryIds(incoming,new Set(incoming.map(x=>x.id))).length,0);
const exported=api.inquiryExport([item], [listing]);assert.equal(exported.headers.length,exported.rows[0].length);assert.equal(exported.rows[0][4],'100001');assert.equal(exported.rows[0][10],'2026-10-22 00:00:00');assert.doesNotMatch(JSON.stringify(exported),/OWNER_SECRET|OWNER_PHONE|PRIVATE_RECEIPT|PRIVATE_REQUEST/);
let csv='';const workspace={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/admin-workspace.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:workspace,require:()=>({}),Blob:class{constructor(parts){csv=parts.join('');}},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},document:{createElement:()=>({click(){}})},setTimeout:()=>{}});workspace.downloadCsv('test.csv',['内容'],[['=1+1'],[' @formula'],['a,"b"\nc']]);assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/'=1\+1/);assert.match(csv,/' @formula/);assert.match(csv,/a,""b""\nc/);
console.log('PASS: Beijing date boundaries, code/title/contact search, new-ID dedup and withdrawn/closed exclusions, complete export whitelist, BOM/quoting/formula defense.');
