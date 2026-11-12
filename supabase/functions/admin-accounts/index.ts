// Admin-only account creation. Service credentials and passwords never enter logs.
const allowedOrigins = new Set(['https://ning73988-jpg.github.io','https://denglai.xin','https://www.denglai.xin','https://songshanhu-enterprise-spaces.pages.dev']);
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  const allowed = allowedOrigins.has(origin);
  const cors: Record<string,string> = { ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}), 'Access-Control-Allow-Headers': 'authorization,apikey,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  const respond = (message: unknown, status = 200) => Response.json(message, { status, headers: cors });
  if (!allowed) return respond({message:'不允许的请求来源'},403);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  if (request.method !== 'POST') return respond({message:'不支持的操作'},405);
  const url = Deno.env.get('SUPABASE_URL') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const auth = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return respond({message:'请先登录管理后台'},401);
  if (!url || !service || !anon) return respond({message:'账号服务尚未配置'},503);
  const signal = AbortSignal.timeout(35000);
  const call = (path: string, options: RequestInit) => fetch(url+path,{...options,signal});
  const head = {apikey:anon,Authorization:auth,'Content-Type':'application/json'};
  const serviceHead = {apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
  let stage: 'checking' | 'creating' | 'granting' = 'checking';
  try {
    const userResponse = await call('/auth/v1/user',{headers:head});
    if (!userResponse.ok) return respond({message:'登录已过期，请重新登录'},401);
    const user = await userResponse.json();
    const roleResponse = await call('/rest/v1/admin_users?select=role,active&user_id=eq.'+encodeURIComponent(user.id),{headers:head});
    if (!roleResponse.ok) return respond({message:'无法核对账号权限，请刷新后重试'},503);
    const roles = await roleResponse.json();
    if (!roles.some((r:{role:string;active:boolean})=>r.role==='superadmin'&&r.active)) return respond({message:'仅超级管理员可新增管理员'},403);
    const raw = await request.text();
    if (raw.length>8000) return respond({message:'请求过长'},400);
    let input;
    try { input = JSON.parse(raw); } catch { return respond({message:'提交内容格式不正确'},400); }
    if (!input || typeof input !== 'object' || !['check','create'].includes(input.action || 'create')) return respond({message:'不支持的账号操作'},400);
    const checking = input.action === 'check';
    const email = String(input.email||'').trim().toLowerCase(), password = String(input.password||''), name=String(input.name||'').trim(), park=String(input.park||'').trim();
    const allParks = park === '__all_parks__';
    if (!checking&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||password.length<12||password.length>128||!park||park.length>120||name.length>60)) return respond({message:'请填写正确的邮箱、园区和12–128位的新密码'},400);
    const [directoryResponse,settingsResponse,parkResponse] = await Promise.all([
      call('/rest/v1/rpc/site_admin_directory',{method:'POST',headers:head,body:'{}'}),
      call('/rest/v1/site_settings?select=admin_limit&id=eq.true',{headers:head}),
      call('/rest/v1/parks?select=id&active=eq.true'+(checking||allParks?'':'&name=eq.'+encodeURIComponent(park)),{headers:head}),
    ]);
    if (!directoryResponse.ok) return respond({message:'管理员目录暂未读取成功，请刷新后台后重试'},503);
    if (!settingsResponse.ok) return respond({message:'平台设置暂未读取成功，请刷新后台后重试'},503);
    if (!parkResponse.ok) return respond({message:'园区列表暂未读取成功，请刷新后台后重试'},503);
    const [directory,settings,parks] = await Promise.all([directoryResponse.json(),settingsResponse.json(),parkResponse.json()]);
    if (!settings.length) return respond({message:'平台设置尚未初始化'},503);
    if (checking) {
      const authAdmin=await call('/auth/v1/admin/users?page=1&per_page=1',{headers:serviceHead});
      if (!authAdmin.ok) return respond({message:'账号创建服务暂不可用，请由网站负责人检查服务端配置'},503);
      await authAdmin.body?.cancel();
      return respond({ready:true});
    }
    if (directory.some((entry:{email:string})=>entry.email?.toLowerCase()===email)) return respond({code:'ALREADY_ADMIN',message:'该邮箱已在管理员列表中，请刷新列表后编辑或启用该账号。'},409);
    if (directory.length>=settings[0].admin_limit) return respond({message:'管理员数量已达上限，请先调整上限或移除不再需要的管理权限'},409);
    if (!allParks&&!parks.length) return respond({message:'请选择一个启用的园区'},400);
    stage='creating';
    const created = await call('/auth/v1/admin/users',{method:'POST',headers:serviceHead,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{display_name:name}})});
    const account = await created.json().catch(()=>null);
    if (!created.ok) {
      const code = account?.code || account?.error_code;
      if (['email_exists','user_already_exists'].includes(code) || /already.*registered|already.*exist/i.test(account?.msg || account?.message || '')) return respond({code:'EMAIL_EXISTS',message:'该邮箱已有本站登录账号。请切换「授权已有账号」，使用原密码登录，不会覆盖原账号密码。'},409);
      if (code==='weak_password' || /password/i.test(account?.msg || account?.message || '')) return respond({message:'初始密码不符合要求，请使用12–128位、包含大小写字母和数字的密码。'},400);
      return respond({message:'登录账号未创建成功，请稍后重试；若已存在，请选择「授权已有账号」。'},created.status===429?429:503);
    }
    stage='granting';
    const id = account?.id || account?.user?.id;
    if (!id) return respond({code:'OPERATION_UNCONFIRMED',message:'账号创建结果暂未确认，请刷新列表核对；若邮箱已注册，可使用「授权已有账号」。'},503);
    const member = await call('/rest/v1/rpc/manage_site_admin',{method:'POST',headers:head,body:JSON.stringify({p_action:'add',p_email:email,p_name:name,p_park:park,p_active:true})});
    if (!member.ok) {
      // Keep the newly created login account. Deleting here can race a successful grant.
      // A fresh, explicitly submitted existing-account grant can finish this operation.
      const problem = await member.json().catch(()=>null);
      const fresh = await call('/rest/v1/rpc/site_admin_directory',{method:'POST',headers:head,body:'{}'});
      if (fresh.ok) {
        const rows = await fresh.json();
        if (rows.some((row:{user_id:string;park:string|null;role:string;active:boolean})=>row.user_id===id&&row.active&&(allParks?row.role==='content_admin':row.park===park&&row.role==='park_admin'))) return respond({id});
      }
      return respond({code:'AUTHORIZATION_PENDING',message:'登录账号已创建，但园区权限尚未确认。请先刷新列表核对；若列表中没有此邮箱，再使用「授权已有账号」完成开通。'+(problem?.message?' 原因：'+problem.message:'')},409);
    }
    return respond({id});
  } catch {
    if (stage==='granting') return respond({code:'AUTHORIZATION_PENDING',message:'登录账号已创建，权限开通结果暂未确认。请刷新管理员列表核对，避免重复创建；未在列表中时可使用「授权已有账号」。'},503);
    if (stage==='creating') return respond({code:'OPERATION_UNCONFIRMED',message:'账号创建结果暂未确认，请先刷新列表核对。若邮箱已注册，可切换「授权已有账号」，请勿连续重复提交。'},503);
    return respond({message:'账号服务连接超时或暂不可用，请检查网络并重试连接。'},503);
  }
});
