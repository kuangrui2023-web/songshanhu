const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/visitor-analytics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject});
const {activeLeadRecords,visitorCode}=exportsObject;
const source=[
 {id:'old',contact:'客户甲',phone:'13800000000',created_at:'2026-10-27T16:01:00Z'},
 {id:'new',contact:'客户甲',phone:'13800000000',created_at:'2026-10-28T01:00:00Z'},
 {id:'withdrawn',contact:'已撤回',phone:'13800000001',created_at:'2026-10-28T02:00:00Z',visitor_withdrawn_at:'2026-10-28T03:00:00Z'},
 {id:'deleted',contact:'回收记录',phone:'13800000002',created_at:'2026-10-28T02:00:00Z',deleted_at:'2026-10-28T03:00:00Z'},
 {id:'empty',contact:'  ',phone:'13800000003',created_at:'2026-10-28T02:00:00Z'},
];
assert.equal(activeLeadRecords(source).map(row=>row.id).join(','),'new,old');
assert.equal(source[0].id,'old','sorting must not mutate loaded inquiry data');
assert.equal(activeLeadRecords(source).length,2,'same phone does not merge records or establish identity');
assert.equal(visitorCode('12345678-9abc-4def-8000-000000000001'),'访客-123456789ABC');
assert.notEqual(visitorCode('12345678-9abc-4def-8000-000000000001'),visitorCode('a2345678-9abc-4def-8000-000000000001'));
console.log('PASS: withdrawn/deleted/blank leads excluded; records retain order and are not merged into identities; anonymous aliases stay pseudonymous.');
