const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8'),window={};
vm.runInNewContext(read('public/experience/listing-codes.js'),{window});
const types={};vm.runInNewContext(ts.transpileModule(read('lib/listing-code.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:types});
for(const [input,expected]of [['100001','100001'],['编号：１００００１','100001'],['房源编号 100001','100001'],['#100001','100001'],['12345',null],['1234567',null],['100001平',null],['电话18600000001',null],['',null]]){assert.equal(window.SiteListingCodes.parse(input),expected);assert.equal(types.listingCode(input),expected);}
const data=read('public/experience/data.js'),start=data.indexOf('function applyFilters(');
const context={window,matchesListingQuery:()=>true,parseListingQuery:()=>({})};vm.createContext(context);vm.runInContext(data.slice(start),context);
const rows=[{id:'one',listingCode:'100001',usage:'写字楼'},{id:'two',listingCode:'100002',usage:'厂房'}];
assert.equal(context.applyFilters(rows,{kw:'编号：100001',usage:'厂房',park:'不存在'}).map(x=>x.id).join(','),'one');
assert.equal(context.applyFilters(rows,{kw:'999999'}).length,0);
let calls=0;Object.assign(context,{document:{getElementById:()=>null},matchMedia:()=>({matches:true}),State:{view:'home',filters:{kw:'',usage:'厂房',park:'南部'},listingsLoading:false,listingsError:false},onlineListings:()=>rows,render:()=>{},toast:()=>{},AbortController,Date,console});
window.addEventListener=()=>{};window.SiteAI={search:()=>{calls++;throw Error('Code lookup must not call AI');}};
vm.runInContext(read('public/experience/search-feedback.js'),context);
(async()=>{await window.HomeSearch.submit('100001');assert.equal(calls,0);assert.equal(window.HomeSearch.matchIds('100001').join(','),'one');assert.equal(context.State.filters.usage,'全部');await window.HomeSearch.submit('999999');assert.equal(calls,0);assert.equal(window.HomeSearch.matchIds('999999').length,0);const editor={};vm.runInNewContext(ts.transpileModule(read('lib/listing-editor.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:editor,require});const preview=editor.publicListingPreview({internal_code:'100001',owner_contact_name:'SECRET',category:'写字楼',title:'办公室'});assert.equal(preview.listing_code,'100001');assert.equal(Object.hasOwn(preview,'internal_code'),false);assert.equal(Object.hasOwn(preview,'owner_contact_name'),false);console.log('PASS: exact six-digit and full-width codes, no partial/phone/area collision, filters reset, AI never called, public alias only.');})().catch(e=>{console.error(e);process.exitCode=1;});
