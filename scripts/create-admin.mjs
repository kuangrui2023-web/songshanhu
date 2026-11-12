#!/usr/bin/env node
/**
 * 在全新 Supabase 项目中创建管理员账号并授予超级管理员。
 *
 * 用法：
 *   1. 在 .env.local 增加（只保存在本机）：
 *        SUPABASE_SERVICE_ROLE_KEY=<service_role 或 sb_secret_ 密钥>
 *        ADMIN_EMAIL=you@example.com
 *        ADMIN_PASSWORD=至少六位
 *   2. 执行：
 *        node --env-file=.env.local scripts/create-admin.mjs
 */
const baseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const email = process.env.ADMIN_EMAIL || "";
const password = process.env.ADMIN_PASSWORD || "";

if (!baseUrl || !serviceKey || !email || !password) {
  console.error("缺少 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY、ADMIN_EMAIL 或 ADMIN_PASSWORD。");
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json"
};

async function createUser() {
  const response = await fetch(`${baseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  const body = await response.json().catch(() => null);
  if (response.ok) return body;

  const message = body?.msg || body?.message || "";
  if (response.status === 422 || /already/i.test(message)) {
    const list = await fetch(`${baseUrl}/auth/v1/admin/users?per_page=200`, { headers });
    const data = await list.json();
    const existing = (data.users || []).find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (existing) return existing;
  }
  throw new Error(`创建用户失败 ${response.status}: ${message}`);
}

const user = await createUser();
const userId = user.id;
if (!userId) throw new Error("没有拿到用户 ID。");

const response = await fetch(`${baseUrl}/rest/v1/admin_users?on_conflict=user_id`, {
  method: "POST",
  headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify([{ user_id: userId, role: "superadmin", park: null, active: true }])
});
if (!response.ok) throw new Error(`授予管理员失败 ${response.status}: ${await response.text()}`);

console.log(`管理员已就绪：${email}（${userId}）`);
console.log("现在可以访问 /admin 登录。");
