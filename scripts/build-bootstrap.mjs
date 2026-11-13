#!/usr/bin/env node
/**
 * 按文档顺序合并 supabase/*.sql，生成可一次粘贴执行的 bootstrap.sql。
 * 修改任何建库脚本后运行：node scripts/build-bootstrap.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const order = [
  "setup.sql",
  "admin_workspace.sql",
  "visitor_intake.sql",
  "visitor_withdraw.sql",
  "admin_all_parks.sql",
  "listing_editor_fields.sql",
  "listing_internal_codes.sql",
  "listing_first_publication.sql",
  "location_privacy.sql",
  "region_privacy.sql",
  "region_options.sql",
  "listing_owner_contacts.sql",
  "public_listing_codes.sql",
  "customer_profiles.sql",
  "ai_search.sql",
  "visitor_analytics.sql",
  "visitor_export.sql",
  "customer_accounts.sql"
];

const parts = [
  "-- 松山湖产业招商网站：全新 Supabase 项目一键建库脚本",
  "-- 由 scripts/build-bootstrap.mjs 按文档顺序合并生成，请勿手工编辑。",
  "-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全文 → Run。",
  ""
];

for (const file of order) {
  const sql = await readFile(path.join(root, "supabase", file), "utf8");
  parts.push(`-- ==================== ${file} ====================`, sql.trimEnd(), "");
}

await writeFile(path.join(root, "supabase", "bootstrap.sql"), parts.join("\n"));
console.log(`已生成 supabase/bootstrap.sql（${order.length} 个脚本）`);
