const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context={window:{},URLSearchParams};
const source=fs.readFileSync('public/experience/area-location.js','utf8');
vm.runInNewContext(source,context);
const api=context.window.SiteAreaLocation;
const privateFields={id:'private-id',parkName:'私密园区',address:'私密详细地址501',lat:22.937123,lng:113.885678};
const points=new Set();
for(const [region,label,position] of [['北部','松山湖北部','113.89,22.96'],['中部','松山湖中部','113.88,22.92'],['南部','松山湖南部','113.89,22.88'],['生态园','松山湖生态园','113.94,23.04'],['大朗','大朗镇','113.94,22.94'],['寮步','寮步镇','113.88,23.00'],['大岭山','大岭山镇','113.84,22.90']]){
  const link=api.linkForListing({region,title:'冲突标题不影响已确认片区',...privateFields});assert.equal(link.label,label);
  const u=new URL(link.url);assert.equal(u.origin,'https://uri.amap.com');assert.equal(u.pathname,'/marker');assert.equal(u.searchParams.get('position'),position);assert.equal(u.searchParams.get('coordinate'),'gaode');assert.equal(u.searchParams.get('callnative'),'0');
  assert.equal(u.searchParams.get('name'),label+'片区示意点（非房源位置）');
  assert.deepEqual([...u.searchParams.keys()].sort(),['callnative','coordinate','name','position','src']);
  points.add(position);
  const [lon,lat]=position.split(',').map(Number);assert.ok(lon>113.7&&lon<114.1&&lat>22.7&&lat<23.2);
  for(const secret of Object.values(privateFields))assert.ok(!decodeURIComponent(u.href).includes(String(secret)));
  assert.equal(link.url,api.linkForListing({region}).url);
  assert.equal(link.url,api.linkForListing({region,title:'另一房源',lat:99,lng:99,address:'另一地址',parkName:'另一园区',id:'other-id'}).url);
  const mutable=api.areaForListing({region});mutable.position='0,0';assert.equal(api.linkForListing({region}).url,link.url);
  const html=api.markup({region,...privateFields});assert.match(html,/查看片区示意/);assert.match(html,/非房源位置/);assert.match(html,/复制片区名称/);assert.match(html,/noopener noreferrer/);assert.match(html,/no-referrer/);
}
assert.equal(points.size,7);
for(const region of ['',null,undefined,'私密园区501','常平','<script>大朗</script>','constructor','__proto__'])assert.equal(api.linkForListing({region,title:'松山湖北部房源',...privateFields}),null);
assert.doesNotMatch(api.markup({title:'办公室',...privateFields}),/<a /);
assert.doesNotMatch(source,/fetch\(|navigator\.geolocation|listing\.(address|lat|lng|parkName|id)/);
assert.doesNotMatch(source,/uri\.amap\.com\/search|keyword:|city:|location\.(href|search)|window\.open/);
console.log('PASS: seven fixed schematic points; same region always same marker; no property coordinates, keyword search, location lookup or SDK; unknown stays unlinked; copy fallback.');
async function testCopy(){
  const app=fs.readFileSync('public/experience/app.js','utf8');
  const body=app.match(/case 'copy:region': \{([\s\S]*?)\n    \}/)[1];
  for(const [v,ok,expected] of [['北部',true,'已复制'],['北部',false,'复制未成功'],['私密园区',true,'片区待确认']]){
    const copies=[],messages=[];
    vm.runInNewContext("switch('copy:region'){case 'copy:region':{"+body+'}}',{v,window:{SiteAreaLocation:api},copyText:text=>{copies.push(text);return Promise.resolve(ok);},toast:text=>messages.push(text)});
    await Promise.resolve();
    assert.match(messages[0],new RegExp(expected));
    assert.deepEqual(copies,v==='北部'?['东莞市松山湖北部']:[]);
  }
  console.log('PASS: copy only accepts public region allowlist; success/failure messages reflect clipboard result.');
}
testCopy().catch(error=>{console.error(error);process.exitCode=1;});

for(const region of ['东城','南城']){
 assert.equal(api.areaForListing({region}).label,region);
 assert.equal(api.linkForListing({region,...privateFields}),null);
 assert.match(api.markup({region,...privateFields}),new RegExp('大致片区：'+region));
 assert.doesNotMatch(api.markup({region,...privateFields}),/<a |待确认/);
}
console.log('PASS: new districts display their known area without inventing a map point.');
