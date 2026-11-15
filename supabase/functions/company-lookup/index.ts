// 快查（同花顺）企业数据 MCP 中转。
// 浏览器始终拿不到 KUAICHA_MCP_KEY；只有登录且在 admin_users 里处于启用状态的管理员能调用。
const MCP_URL = 'https://bizveris.kuaicha365.com/mcp';
const TOOL_ID = 'basic_get_enterprise_basic_info';
const allowedOrigins = new Set([
  'https://kuangrui2023-web.github.io',
  'https://denglai.xin',
  'https://www.denglai.xin',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
]);

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://kuangrui2023-web.github.io',
  'Access-Control-Allow-Headers': 'authorization,apikey,content-type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  Vary: 'Origin',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
});

const json = (body: unknown, status: number, origin: string) =>
  Response.json(body, { status, headers: corsHeaders(origin) });

/** MCP 以 SSE 返回，事件之间用空行分隔，data 可能跨多行。 */
function parseEventStream(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed); } catch { /* 继续按 SSE 解析 */ }
  }
  let data: string[] = [];
  let last: unknown = null;
  const flush = () => {
    if (!data.length) return;
    try { last = JSON.parse(data.join('\n')); } catch { /* 忽略坏事件 */ }
    data = [];
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    else if (line === '') flush();
  }
  flush();
  return last;
}

async function mcpRpc(body: unknown, sessionId: string | null, key: string, timeout: number) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'open-authorization': `Bearer ${key}`,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP_HTTP_${response.status}: ${text.slice(0, 200)}`);
  return { sessionId: response.headers.get('mcp-session-id'), payload: parseEventStream(text) };
}

const str = (value: unknown, max: number) => {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const num = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** “13600万人民币” → 13600；非人民币单位不猜汇率，返回 null。 */
function capitalFromText(value: unknown): number | null {
  const m = /^([\d.]+)\s*万\s*(人民币|美元|港元|欧元|日元)/.exec(String(value ?? '').trim());
  if (!m || m[2] !== '人民币') return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

type CompanyFields = Record<string, string | number | null>;

/** 只返回查到的字段；没查到的字段不出现，客户端就不会覆盖已有内容。 */
function mapCompany(data: Record<string, unknown>): CompanyFields {
  const fields: CompanyFields = {};
  const put = (key: string, value: string | number | null) => { if (value !== null) fields[key] = value; };
  put('name', str(data.corp_name, 200));
  put('unified_code', str(data.creditcode, 32));
  put('legal_representative', str(data.legal_person, 60));
  put('registered_capital', num(data.reg_capital_pub) ?? capitalFromText(data.capital));
  const established = String(data.established_date ?? '');
  put('established_on', /^\d{4}-\d{2}-\d{2}$/.test(established) ? established : null);
  put('status', str(data.state, 40));
  put('address', str(data.address, 300));
  put('industry', str(data.small_industry || data.fourth_industry || data.big_industry, 120));
  put('business_scope', str(data.operating_scope, 4000));
  put('social_insurance_count', num(data.social_staff_num));
  return fields;
}

async function lookupCompany(name: string, key: string) {
  const init = await mcpRpc({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'songshanhu-admin', version: '1.0.0' },
    },
  }, null, key, 15_000);
  if (!init.sessionId) throw new Error('MCP_NO_SESSION');
  await mcpRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, init.sessionId, key, 10_000);
  const called = await mcpRpc({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: {
      name: 'call',
      arguments: { tool_id: TOOL_ID, params_to_tool: JSON.stringify({ corp_name: name }) },
    },
  }, init.sessionId, key, 25_000);

  const rpc = called.payload as { error?: { message?: string }; result?: { content?: { type?: string; text?: string }[] } };
  if (rpc?.error) throw new Error(`MCP_RPC: ${rpc.error.message || 'unknown'}`);
  const text = rpc?.result?.content?.find(item => item?.type === 'text')?.text;
  if (!text) throw new Error('MCP_EMPTY');
  const outer = JSON.parse(text) as Record<string, unknown>;
  const inner = typeof outer.raw === 'string'
    ? JSON.parse(outer.raw) as Record<string, unknown>
    : outer;
  const data = (inner.data ?? (inner.status_code === undefined ? inner : null)) as Record<string, unknown> | null;
  if (!data || !str(data.corp_name, 200)) return null;
  return { fields: mapCompany(data), orgid: str(data.orgid, 40) };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin') || '';
  if (!allowedOrigins.has(origin)) return json({ message: '不允许的请求来源。' }, 403, origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== 'POST') return json({ message: '不支持的操作。' }, 405, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const kuaichaKey = Deno.env.get('KUAICHA_MCP_KEY') || '';
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ message: '企业查询服务尚未配置。' }, 503, origin);
  if (!kuaichaKey) return json({ message: '快查密钥尚未配置，请联系维护者。' }, 503, origin);

  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(authorization)) return json({ message: '请先登录管理后台。' }, 401, origin);

  // 1) 确认是本站登录用户；2) 确认在 admin_users 里启用。
  let userId = '';
  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
      signal: AbortSignal.timeout(10_000),
    });
    if (!userResponse.ok) return json({ message: '登录已过期，请重新登录管理后台。' }, 401, origin);
    const user = await userResponse.json() as { id?: string };
    userId = String(user.id || '');
  } catch {
    return json({ message: '无法核对登录状态，请检查网络后重试。' }, 503, origin);
  }
  if (!userId) return json({ message: '登录已过期，请重新登录管理后台。' }, 401, origin);

  try {
    const roleResponse = await fetch(
      `${supabaseUrl}/rest/v1/admin_users?select=role,active&user_id=eq.${encodeURIComponent(userId)}`,
      {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!roleResponse.ok) return json({ message: '无法核对管理员权限，请稍后重试。' }, 503, origin);
    const rows = await roleResponse.json() as { role?: string; active?: boolean }[];
    if (!Array.isArray(rows) || !rows.some(row => row.active === true)) {
      return json({ message: '当前账号没有管理员权限。' }, 403, origin);
    }
  } catch {
    return json({ message: '无法核对管理员权限，请稍后重试。' }, 503, origin);
  }

  let name = '';
  try {
    const body = await request.json() as { name?: unknown };
    name = String(body?.name ?? '').trim();
  } catch { /* 下面统一校验 */ }
  if (name.length < 2 || name.length > 100) {
    return json({ message: '请先填写完整的企业名称（2–100 字）再查询。' }, 400, origin);
  }

  try {
    const result = await lookupCompany(name, kuaichaKey);
    if (!result) {
      return json({ message: `快查没有找到「${name}」。请改用营业执照上的完整名称再试。` }, 404, origin);
    }
    return json({
      company: result.fields,
      matched_name: result.fields.name,
      orgid: result.orgid,
      source: 'kuaicha',
      lookup_at: new Date().toISOString(),
    }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/MCP_HTTP_401|Unauthorized|invalid/i.test(message)) {
      return json({ message: '快查密钥无效或已过期，请联系维护者更新。' }, 502, origin);
    }
    if (/timeout|abort|TimeoutError/i.test(message)) {
      return json({ message: '快查响应超时，请稍后重试（本次通常不扣费）。' }, 504, origin);
    }
    console.error('company-lookup failed', message);
    return json({ message: '快查查询失败，请稍后重试。' }, 502, origin);
  }
});
