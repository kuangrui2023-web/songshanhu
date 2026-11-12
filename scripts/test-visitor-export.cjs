const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync('lib/visitor-export.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
let calls=[],downloads=[],mode='valid';const out={};
const records=Array.from({length:501},(_,id)=>({id,visitor_id:'visitor-'+id,first_seen:'first',last_seen:'last',sessions:1,views:1,listing_id:'listing',listing_code:'100001',title:'=危险公式',created_at:'time'}));
vm.runInNewContext(code,{exports:out,Date,Set,Error,require:name=>name==='./admin-workspace'?{
 workspaceRequest:async(_,b)=>{calls.push(b);if(mode==='network'&&b.p_page)throw new Error('network');return {rows:mode==='empty'&&b.p_page?[]:records.slice(b.p_page*500,b.p_page*500+500),total:501,page:b.p_page,page_size:500,snapshot:mode==='snapshot'&&b.p_page?999:501};},downloadCsv:(...args)=>downloads.push(args)
}:name==='./visitor-analytics'?{visitorCode:id=>'访客-'+id}:{beijingDate:x=>x}});
(async()=>{
 assert.equal(await out.exportAnonymousVisits('summary'),501);assert.equal(calls.length,2);assert.equal(calls[1].p_snapshot,501);assert.equal(downloads[0][2].length,501);assert.equal(downloads[0][1].length,6);
 calls=[];assert.equal(await out.exportAnonymousVisits('views'),501);assert.equal(downloads[1][2][0][4],'=危险公式','values pass through shared safe CSV writer');assert.equal(downloads[1][1].length,6);
 for(mode of ['network','empty','snapshot']){const count=downloads.length;await assert.rejects(out.exportAnonymousVisits('views'));assert.equal(downloads.length,count,'never download partial data');}
 console.log('PASS all pages, immutable export boundary, two CSV layouts and no partial download on network/empty-page/range changes');
})().catch(e=>{console.error(e);process.exitCode=1;});
