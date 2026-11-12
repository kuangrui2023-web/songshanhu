#!/usr/bin/env node
/**
 * 导出原站点的公开数据（房源 + 图片/视频），用于迁移到自己的 Supabase。
 *
 * 用法：
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/export-public-data.mjs --out="E:/claude code/songshanhu-backup/2026-11-12"
 *
 * 说明：
 * - 只读取公开视图 public_listings，不涉及任何私有数据（留言、管理员账号）。
 * - 图片/视频来自公开存储桶，按原始 URL 路径保存，便于之后重新上传。
 * - 脚本可重复运行，已下载的文件会跳过。
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  })
);

const baseUrl = (process.env.SUPABASE_URL || args.url || "").replace(/\/$/, "");
const anonKey = process.env.SUPABASE_ANON_KEY || args.key || "";
const outDir = path.resolve(args.out || "export");
const pageSize = 1000;
const concurrency = 6;

if (!baseUrl || !anonKey) {
  console.error("缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY。");
  process.exit(1);
}

const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

async function fetchJson(url, attempt = 1) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if ((response.status === 429 || response.status >= 500) && attempt <= 3) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    return fetchJson(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`请求失败 ${response.status}: ${url}\n${await response.text()}`);
  return response.json();
}

async function fetchAllListings() {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = `${baseUrl}/rest/v1/public_listings?select=*&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
    const page = await fetchJson(url);
    rows.push(...page);
    console.log(`已获取房源 ${rows.length} 条`);
    if (page.length < pageSize) break;
  }
  return rows;
}

function safeRelativePath(mediaUrl) {
  const url = new URL(mediaUrl);
  const marker = "/storage/v1/object/public/";
  const index = url.pathname.indexOf(marker);
  if (index === -1) return null;
  const relative = decodeURIComponent(url.pathname.slice(index + marker.length));
  const normalized = path.posix.normalize(relative);
  if (normalized.startsWith("..") || path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

async function download(mediaUrl, destination, attempt = 1) {
  try {
    await readFile(destination);
    return { skipped: true };
  } catch {
    // 文件不存在，继续下载
  }
  const response = await fetch(mediaUrl, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt <= 3) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return download(mediaUrl, destination, attempt + 1);
    }
    throw new Error(`下载失败 ${response.status}: ${mediaUrl}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);
  return { skipped: false, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
}

const listings = await fetchAllListings();
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "listings.json"), JSON.stringify(listings, null, 2));

const media = [];
const seen = new Set();
for (const listing of listings) {
  for (const url of [...(listing.images || []), ...(listing.videos || [])]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    media.push({ listingId: listing.id, url });
  }
}

console.log(`共 ${listings.length} 条房源，${media.length} 个媒体文件，开始下载到 ${outDir}`);
let done = 0;
const manifest = [];
const queue = [...media];
async function worker() {
  for (;;) {
    const item = queue.shift();
    if (!item) return;
    const relative = safeRelativePath(item.url);
    if (!relative) {
      console.warn(`跳过非存储文件: ${item.url}`);
      continue;
    }
    const destination = path.join(outDir, "media", relative);
    const result = await download(item.url, destination);
    manifest.push({ ...item, file: path.posix.join("media", relative), ...result });
    done += 1;
    if (done % 20 === 0 || done === media.length) console.log(`已处理 ${done}/${media.length}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

await writeFile(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    {
      source: baseUrl,
      exportedAt: new Date().toISOString(),
      listingCount: listings.length,
      mediaCount: media.length,
      media: manifest.sort((a, b) => a.url.localeCompare(b.url)),
    },
    null,
    2
  )
);

console.log("导出完成。");
console.log(`房源数据: ${path.join(outDir, "listings.json")}`);
console.log(`媒体文件: ${path.join(outDir, "media")}`);
console.log(`清单: ${path.join(outDir, "manifest.json")}`);
