const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('public/experience/ai-search.js','utf8');
const fixture=[{id:'a',listing_code:'100001',title:'公开办公室167平',contact_name:'公开顾问',contact_phone:'18600000001',wechat:null},{id:'b',listing_code:'100002',title:'公开厂房3000平',contact_name:'另一顾问',contact_phone:'18600000002',wechat:'public-wechat'}];
async function run(query,{rows=fixture,hotline='400-000-0000',fail=false,contextIds=[]}={}){
  const calls=[];const window={__SITE_BACKEND__:{url:'https://public.example',key:'public-key'}};
  vm.runInNewContext(code,{window,AbortController,setTimeout,clearTimeout,TextDecoder,fetch:async(url,options)=>{
    calls.push({url,options});
    assert.doesNotMatch(url,/functions\/v1|owner_|\/listings\?|\/parks\?/);
    const allowed=url.includes('/public_listings?')||url.includes('/site_settings?select=hotline');assert.ok(allowed,url);
    return {ok:!fail,json:async()=>url.includes('/public_listings?')?rows:[{hotline}]};
  }});
  const response=await window.SiteAI.search(query,{contextIds,filters:{park:'没有房源的筛选'}});
  assert.equal(response.intent,'contact');assert.equal(response.calledModel,false);assert.equal(response.ids.length,0);
  return {response,calls,api:window.SiteAI};
}
(async()=>{
  assert.equal((await run('招商的联系方式')).response.reply,'网站公开招商热线：400-000-0000。');
  assert.match((await run('你们电话多少')).response.reply,/400-000-0000/);
  assert.match((await run('100001 招商电话')).response.reply,/18600000001/);
  assert.doesNotMatch((await run('100001 招商电话')).response.reply,/18600000002/);
  assert.match((await run('１００００１ 的联系方式')).response.reply,/18600000001/);
  assert.match((await run('公开办公室167平怎么联系')).response.reply,/18600000001/);
  assert.match((await run('这套怎么联系',{contextIds:['a']})).response.reply,/18600000001/);
  assert.match((await run('第二套怎么联系',{contextIds:['a','b']})).response.reply,/18600000002/);
  assert.match((await run('这套怎么联系')).response.reply,/哪一套/);
  assert.match((await run('100099 联系方式')).response.reply,/没有找到/);
  const denied=await run('业主电话');assert.match(denied.response.reply,/不公开/);assert.equal(denied.calls.length,0);
  assert.match((await run('招商联系方式',{hotline:'',rows:[]})).response.reply,/暂未填写/);
  assert.match((await run('招商联系方式',{hotline:'',rows:fixture.slice(0,1)})).response.reply,/18600000001/);
  assert.match((await run('招商联系方式',{hotline:''})).response.reply,/不同房源/);
  assert.match((await run('100001 微信号',{rows:[{...fixture[0],contact_phone:null}],hotline:''})).response.reply,/暂未填写/);
  await assert.rejects(run('招商联系方式',{fail:true}),/暂时无法读取公开招商联系方式/);
  const {api}=await run('招商联系方式');
  for(const q of ['我要200平写字楼','物业费多少钱','不要打电话，帮我找厂房'])assert.equal(api.isContactQuestion(q),false,q);
  const feedback=fs.readFileSync('public/experience/search-feedback.js','utf8');
  const start=feedback.indexOf("if(result.intent==='contact')");
  const branch=feedback.slice(start,feedback.indexOf('      selection={query',start));
  assert.doesNotMatch(branch,/State\.filters\.kw\s*=|selection\s*=/);
  // Run the actual composer controller: contact answers must not become search
  // keywords, clear selected filters, pollute model history, or hide results.
  let question='招商的联系方式',sentHistory=[],rendered='';
  const filters={kw:'',park:'北部',usage:'写字楼'};
  const state={filters,listingsError:true,listingsLoading:false,view:'home'};
  const list=[{id:'a',listingCode:'100001',title:'测试房源',status:'online',parkName:'北部',area:167,rent:60}];
  const context={State:state,window:{SiteAI:{isContactQuestion:api.isContactQuestion,search:async(q,options)=>{
    sentHistory.push([...options.history]);
    return api.isContactQuestion(q)?{intent:'contact',reply:'公开顾问，电话：18600000001',calledModel:false,ids:[],matches:[],summary:[]}:{reply:'已推荐',calledModel:true,ids:['a'],matches:[{id:'a',reason:'测试'}],summary:[]};
  }}},document:{getElementById:id=>id==='view-home'?{}:{value:question,blur(){}}},AbortController,Date,matchMedia:()=>({matches:true}),setInterval,clearInterval,
  onlineListings:()=>list,applyFilters:items=>items,esc:value=>String(value).replace(/[<>&]/g,'_'),toast(){},render(){}};
  context.window.SiteListingCodes={parse:()=>null};
  context.window.addEventListener=()=>{};
  vm.runInNewContext(feedback,context);
  await context.window.HomeSearch.submit();
  assert.equal(state.filters.kw,'');assert.equal(state.filters.park,'北部');
  assert.match(context.window.HomeSearch.markup(list),/18600000001|已查询公开招商资料/);
  state.listingsError=false;question='167平写字楼';await context.window.HomeSearch.submit();
  assert.equal(sentHistory[1].length,0);
  assert.deepEqual(Array.from(context.window.HomeSearch.matchIds(question)),['a']);
  question='这套怎么联系';await context.window.HomeSearch.submit();
  assert.equal(state.filters.kw,'167平写字楼');assert.equal(state.filters.park,'北部');
  assert.deepEqual(Array.from(context.window.HomeSearch.matchIds('167平写字楼')),['a']);
  console.log('PASS: contact intent, site hotline, exact code/title, contextual/ordinal lookup, private refusal, missing/error fallback, no AI call and preserved search filters.');
})().catch(error=>{console.error(error);process.exitCode=1;});
