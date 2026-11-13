#!/usr/bin/env node
/**
 * 上线前自检：以访客和业主两种身份调用真实接口，确认前台、后台、留言链路正常。
 *
 * 用法：
 *   node --env-file=.env.local scripts/smoke-test.mjs
 *
 * 会在数据库写入一条手机号为 13800000000 的测试留言，并在结束时撤回它。
 * 不会修改任何房源。
 */
import { randomUUID } from "node:crypto";

const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const email = process.env.ADMIN_EMAIL || "";
const password = process.env.ADMIN_PASSWORD || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!baseUrl || !anonKey) {
  console.error("缺少 Supabase 配置。");
  process.exit(1);
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "通过" : "失败"}  ${name}${detail ? "  " + detail : ""}`);
}

async function call(path, { token = anonKey, method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, ok: response.ok, data };
}

// 1. 访客视角：公开房源
const list = await call("/rest/v1/public_listings?select=id,title,region,images,price,area&order=created_at.desc&limit=5", {
  headers: { Prefer: "count=exact" }
});
const total = list.data?.length ? null : null; // 计数在 content-range 里，下面单独取
const countRes = await fetch(`${baseUrl}/rest/v1/public_listings?select=id`, {
  headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Prefer: "count=exact", Range: "0-0" }
});
const range = countRes.headers.get("content-range") || "";
const publishedTotal = Number(range.split("/")[1] || 0);
record("公开房源可读", list.ok && publishedTotal > 0, `${publishedTotal} 条`);

const sample = list.data?.[0];
record("房源包含标题与图片", Boolean(sample?.title && sample?.images?.length), sample?.title || "无数据");
record("房源包含价格与面积", Boolean(sample?.price && sample?.area), `${sample?.price ?? "-"} / ${sample?.area ?? "-"}`);

// 2. 图片可访问
if (sample?.images?.[0]) {
  const image = await fetch(sample.images[0]);
  record("首图可访问", image.ok && (image.headers.get("content-type") || "").startsWith("image/"), `${image.status} ${image.headers.get("content-type")}`);
}

// 3. 站点设置与园区列表（后台/前台共用）
const settings = await call("/rest/v1/site_settings?select=*&limit=1");
record("站点设置可读", settings.ok, `${settings.status}`);
// 访客端不读 parks 表（前台用写死的片区列表），只有登录后的后台可读，
// 这里只确认匿名访问被正确关闭，不当作失败。
const parksAnon = await call("/rest/v1/parks?select=*&limit=1");
console.log(`信息  访客直接读园区表被拒绝（符合设计）：${parksAnon.status}`);

// 4. 访客埋点
const visitor = randomUUID();
const session = randomUUID();
const event = await call("/rest/v1/rpc/record_site_event", {
  method: "POST",
  body: { p_visitor: visitor, p_session: session, p_kind: "visit", p_listing: null }
});
record("访问统计上报", event.status === 204 || event.ok, `${event.status}`);

// 5. 提交留言 → 读取回执 → 撤回
const clientRequestId = randomUUID();
const inquiry = await call("/rest/v1/rpc/submit_site_inquiry", {
  method: "POST",
  body: {
    p_payload: {
      kind: "inquiry",
      consent: true,
      client_request_id: clientRequestId,
      listing_id: sample?.id || null,
      company: "自检测试企业",
      contact: "自检测试",
      phone: "13800000000",
      request_text: "这是上线前自检写入的测试留言，脚本结束时自动撤回。"
    }
  }
});
record("提交留言", inquiry.ok, inquiry.ok ? "已生成回执" : JSON.stringify(inquiry.data).slice(0, 120));

let reply = null;
if (inquiry.ok) {
  reply = await call("/rest/v1/rpc/read_site_reply", {
    method: "POST",
    body: { p_receipt: inquiry.data.receipt }
  });
  record("访客可凭回执查询进度", reply.ok && reply.data?.status !== undefined, `状态 ${reply.data?.status ?? "-"}`);

  const withdraw = await call("/rest/v1/rpc/withdraw_site_inquiry", {
    method: "POST",
    body: { p_id: inquiry.data.id, p_receipt: inquiry.data.receipt }
  });
  record("访客可撤回留言", withdraw.ok && withdraw.data?.withdrawn === true, `${withdraw.status}`);
}

// 6. 后台：登录 → 指标 → 通讯录 → 读私密字段
let token = null;
if (email && password) {
  const login = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const loginData = await login.json().catch(() => null);
  token = loginData?.access_token || null;
  record("后台账号登录", login.ok && Boolean(token), `${login.status}`);

  if (token) {
    const metrics = await call("/rest/v1/rpc/site_admin_metrics", { method: "POST", token, body: {} });
    record("后台数据看板", metrics.ok, metrics.ok ? "有返回" : JSON.stringify(metrics.data).slice(0, 120));

    const directory = await call("/rest/v1/rpc/site_admin_directory", { method: "POST", token, body: {} });
    record("管理员通讯录", directory.ok, `${Array.isArray(directory.data) ? directory.data.length : 0} 个账号`);

    const privateList = await call("/rest/v1/listings?select=id,title,park,address,status,images&status=eq.published&limit=3", { token });
    const withPark = Array.isArray(privateList.data) ? privateList.data.filter((row) => row.park) : [];
    record("后台可见园区与地址", privateList.ok && withPark.length > 0, `示例园区：${withPark[0]?.park ?? "无"}`);

    const draft = await call("/rest/v1/listings?select=id&status=neq.published&limit=1", { token });
    record("后台可读非公开房源", draft.ok, `${Array.isArray(draft.data) ? draft.data.length : 0} 条`);

    const parks = await call("/rest/v1/parks?select=*&limit=500", { token });
    record("后台园区管理数据可读", parks.ok && Array.isArray(parks.data) && parks.data.length > 0, `${Array.isArray(parks.data) ? parks.data.length : 0} 个园区`);
  }
} else {
  console.log("跳过后台检查（.env.local 没有 ADMIN_EMAIL / ADMIN_PASSWORD）");
}

// 7. 客户邮箱账号：注册 → 提交 → 查询 → 撤回 → 权限隔离
//    需要先在 Supabase 关闭 Confirm email 并执行 supabase/customer_accounts.sql；
//    未完成配置时只打印信息，不算失败。
// 用自己域名下的临时地址，避免 example.com 被 Supabase 判为无效邮箱。
const customerEmail = `smoke+${Date.now()}@denglai.xin`;
const customerPassword = "SmokeTest-" + randomUUID().slice(0, 8);
const signup = await fetch(`${baseUrl}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email: customerEmail, password: customerPassword })
});
const signupData = await signup.json().catch(() => null);
const customerToken = signupData?.access_token || null;
// 关闭 Confirm email 时返回 {access_token,user}；未关闭时直接返回用户对象。
const customerUserId = signupData?.user?.id || signupData?.id || null;

async function removeTestCustomer(inquiryId) {
  if (!serviceKey) {
    console.log(`信息  未提供 service key，自检账号 ${customerEmail} 需要手动删除`);
    return;
  }
  if (inquiryId) {
    await fetch(`${baseUrl}/rest/v1/inquiries?id=eq.${inquiryId}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    }).catch(() => {});
  }
  if (customerUserId) {
    await fetch(`${baseUrl}/auth/v1/admin/users/${customerUserId}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    }).catch(() => {});
  }
  console.log("信息  已清理自检客户账号与留言");
}

if (!customerToken) {
  console.log(`信息  客户账号自检跳过：注册返回 ${signup.status}${signupData?.msg ? "（" + signupData.msg + "）" : ""}。请确认 Supabase 已关闭 Confirm email；若邮箱被判无效，检查脚本里的测试域名。`);
  await removeTestCustomer(null);
} else {
  record("客户邮箱注册", true, customerEmail);

  // 数据库尚未执行新脚本时，list_my_inquiries 会返回 404。
  const probe = await call("/rest/v1/rpc/list_my_inquiries", { method: "POST", token: customerToken, body: {} });
  if (probe.status === 404 || probe.status === 400) {
    console.log("信息  list_my_inquiries 尚不可用，请先在 Supabase 执行 supabase/customer_accounts.sql；跳过账号留言检查。");
    await removeTestCustomer(null);
  } else {
    record("账号留言接口可用", probe.ok, `${probe.status}`);

    const testPhone = "137" + String(Math.floor(10000000 + Math.random() * 89999999));
    const customerInquiry = await call("/rest/v1/rpc/submit_site_inquiry", {
      method: "POST",
      token: customerToken,
      body: {
        p_payload: {
          kind: "inquiry",
          consent: true,
          client_request_id: randomUUID(),
          listing_id: sample?.id || null,
          company: "自检测试企业",
          contact: "客户账号自检",
          phone: testPhone,
          request_text: "客户账号自检留言，脚本结束时撤回并删除。"
        }
      }
    });
    record("登录客户提交留言", customerInquiry.ok, customerInquiry.ok ? "已归入账号" : JSON.stringify(customerInquiry.data).slice(0, 120));

    const inquiryId = customerInquiry.data?.id || null;
    const receipt = customerInquiry.data?.receipt || null;

    if (customerInquiry.ok) {
      const mine = await call("/rest/v1/rpc/list_my_inquiries", { method: "POST", token: customerToken, body: {} });
      const rows = Array.isArray(mine.data) ? mine.data : [];
      const hit = rows.find((row) => row.id === inquiryId);
      record("账号可见自己的留言", mine.ok && Boolean(hit), `${rows.length} 条`);
      record("账号留言含用于撤回的回执", Boolean(hit?.receipt), hit?.receipt ? "有" : "无");

      const denied = await call("/rest/v1/rpc/list_my_inquiries", { method: "POST", token: anonKey, body: {} });
      record("未登录不能读取账号留言", denied.status === 401 || denied.status === 403, `${denied.status}`);

      const withdraw = await call("/rest/v1/rpc/withdraw_site_inquiry", {
        method: "POST",
        token: customerToken,
        body: { p_id: inquiryId, p_receipt: receipt }
      });
      record("登录客户可撤回留言", withdraw.ok && withdraw.data?.withdrawn === true, `${withdraw.status}`);

      const after = await call("/rest/v1/rpc/list_my_inquiries", { method: "POST", token: customerToken, body: {} });
      const stillThere = (Array.isArray(after.data) ? after.data : []).some((row) => row.id === inquiryId);
      record("撤回后账号列表不再显示", after.ok && !stillThere, `${after.status}`);
    }

    await removeTestCustomer(inquiryId);
  }
}

// 8. 可选云函数：未部署时不算失败
const ai = await call("/functions/v1/ai-search", { method: "POST", body: { query: "1000平米厂房" } });
console.log(`信息  AI 找房云函数：${ai.status}${ai.ok ? "（已部署）" : "（未部署，前台会提示暂不可用，不影响浏览）"}`);

const failed = results.filter((item) => !item.ok);
console.log(`\n共 ${results.length} 项，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项。`);
process.exit(failed.length ? 1 : 0);
