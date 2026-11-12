const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
let handler,role='superadmin',calls=[];
vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/admin-accounts/index.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
 Request,Response,AbortSignal,Set,JSON,encodeURIComponent,
 Deno:{serve:fn=>handler=fn,env:{get:name=>({SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'server-test-key',SUPABASE_ANON_KEY:'public-test-key'}[name])}},
 fetch:async(url,options)=>{calls.push({url,method:options.method||'GET'});let data=[];
 if(url.endsWith('/auth/v1/user'))data={id:'test-user'};
 else if(url.includes('/rest/v1/admin_users?'))data=[{role,active:true}];
 else if(url.includes('/rest/v1/site_settings?'))data=[{admin_limit:5}];
 else if(url.includes('/auth/v1/admin/users?'))data={users:[]};
 return Response.json(data);}
});
(async()=>{
 for(const origin of ['https://denglai.xin','https://www.denglai.xin','https://songshanhu-enterprise-spaces.pages.dev','https://ning73988-jpg.github.io']){
  calls=[];let r=await handler(new Request('https://test.invalid',{method:'OPTIONS',headers:{Origin:origin}}));
  assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal(calls.length,0);
  r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test-session'},body:JSON.stringify({action:'check'})}));
  assert.equal(r.status,200);assert.equal((await r.json()).ready,true);assert.equal(r.headers.get('access-control-allow-origin'),origin);
  assert.ok(calls.every(c=>c.method!=='POST'||c.url.endsWith('/rpc/site_admin_directory')),'health check must never create an account');
 }
 for(const origin of ['https://denglai.xin.evil.invalid','http://denglai.xin','https://untrusted.pages.dev','null','']){
  calls=[];const r=await handler(new Request('https://test.invalid',{method:'OPTIONS',headers:{Origin:origin}}));
  assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);assert.equal(calls.length,0);
 }
 let r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Origin:'https://denglai.xin'},body:'{"action":"check"}'}));assert.equal(r.status,401);
 role='park_admin';r=await handler(new Request('https://test.invalid',{method:'POST',headers:{Origin:'https://denglai.xin',Authorization:'Bearer test-session'},body:'{"action":"check"}'}));assert.equal(r.status,403);
 console.log('PASS: exact site origins; untrusted origins blocked; check is read-only; missing session and non-superadmin rejected.');
})().catch(e=>{console.error(e);process.exitCode=1});
