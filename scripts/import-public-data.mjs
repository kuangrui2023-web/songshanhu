#!/usr/bin/env node
/**
 * 把导出的公开房源与图片导入到自己的 Supabase。
 *
 * 前置条件：
 * 1. 新项目已执行 supabase/bootstrap.sql，存在 listings 表和 listing-media 存储桶。
 * 2. 在 .env.local 中填写：
 *      SUPABASE_URL=https://<项目>.supabase.co
 *      SUPABASE_SERVICE_ROLE_KEY=<service_role 或 sb_secret_ 密钥>
 *    service_role 密钥只能留在本机，绝不提交、不发给任何人。
 *
 * 用法：
 *   node --env-file=.env.local scripts/import-public-data.mjs --data="E:/claude code/songshanhu-backup/2026-11-12"
 *   node --env-file=.env.local scripts/import-public-data.mjs --data="..." --dry-run
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  })
);

const baseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!baseUrl || !serviceKey) {
  console.error("缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。");
  process.exit(1);
}
const dataDir = path.resolve(args.data || "export");
const dryRun = Object.prototype.hasOwnProperty.call(args, "dry-run");
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
const assetTypes = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime"
};

const allListings = JSON.parse(await readFile(path.join(dataDir, "listings.json"), "utf8"));
const limit = Number(args.limit || 0);
const listings = limit > 0 ? allListings.slice(0, limit) : allListings;
const manifest = JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf8"));
const mediaByUrl = new Map(manifest.media.map((item) => [item.url, item]));

function objectPath(mediaUrl) {
  const marker = "/storage/v1/object/public/";
  const index = mediaUrl.indexOf(marker);
  if (index === -1) return null;
  const full = decodeURIComponent(new URL(mediaUrl).pathname.slice(new URL(mediaUrl).pathname.indexOf(marker) + marker.length));
  const [bucket, ...rest] = full.split("/");
  return { bucket, path: rest.join("/") };
}

async function uploadMedia(mediaUrl) {
  const item = mediaByUrl.get(mediaUrl);
  if (!item) throw new Error(`备份清单中找不到: ${mediaUrl}`);
  const target = objectPath(mediaUrl);
  if (!target) throw new Error(`无法识别的存储地址: ${mediaUrl}`);
  const localFile = path.join(dataDir, item.file);
  const body = await readFile(localFile);
  const ext = path.extname(localFile).toLowerCase();
  const response = await fetch(
    `${baseUrl}/storage/v1/object/${target.bucket}/${target.path.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": assetTypes[ext] || "application/octet-stream",
        "x-upsert": "true"
      },
      body
    }
  );
  if (!response.ok) throw new Error(`上传失败 ${response.status}: ${mediaUrl}\n${await response.text()}`);
  return `${baseUrl}/storage/v1/object/public/${target.bucket}/${target.path}`;
}

const REGION_PARK = {
  北部: "松山湖北部",
  中部: "松山湖中部",
  南部: "松山湖南部",
  生态园: "松山湖生态园",
  大朗: "大朗",
  寮步: "寮步",
  大岭山: "大岭山",
  东城: "东城",
  南城: "南城"
};

function inferRegion(listing) {
  if (listing.region) return listing.region;
  const text = [listing.title, listing.park, listing.address].filter(Boolean).join(" ");
  const matches = Object.keys(REGION_PARK).filter((region) => text.includes(region));
  return matches.length === 1 ? matches[0] : null;
}

function toRow(listing, imageUrls, videoUrls) {
  const region = inferRegion(listing);
  const visibility = {};
  if (listing.has_agent_fee !== null && listing.has_agent_fee !== undefined) visibility.has_agent_fee = true;
  if (listing.wechat) visibility.wechat = true;
  if (listing.video_channel) visibility.video_channel = true;
  return {
    id: listing.id,
    title: listing.title,
    category: listing.category,
    park: listing.park || REGION_PARK[region] || "待确认",
    region,
    unit: listing.unit,
    building: listing.building,
    room: listing.room,
    unit_split: Boolean(listing.building || listing.room),
    floor: listing.floor,
    area: listing.area,
    price: listing.price,
    fee: listing.fee,
    facing: listing.facing,
    layout: listing.layout,
    decoration: listing.decoration,
    description: listing.description,
    free_rent_period: listing.free_rent_period,
    supporting_facilities: listing.supporting_facilities,
    compatible_industries: listing.compatible_industries,
    factory_height: listing.factory_height,
    factory_load: listing.factory_load,
    factory_power: listing.factory_power,
    fire_rating: listing.fire_rating,
    environmental_requirements: listing.environmental_requirements,
    internal_code: listing.listing_code,
    address: listing.address,
    latitude: listing.latitude,
    longitude: listing.longitude,
    contact_name: listing.contact_name,
    contact_phone: listing.contact_phone,
    tag: listing.tag,
    views: listing.views ?? 0,
    images: imageUrls,
    videos: videoUrls,
    status: "published",
    created_at: listing.created_at,
    first_published_at: listing.first_published_at,
    payment_terms: listing.payment_terms,
    has_crane_support: listing.has_crane_support,
    freight_elevator_load: listing.freight_elevator_load,
    freight_elevator_size: listing.freight_elevator_size,
    has_passenger_elevator: listing.has_passenger_elevator,
    has_water: listing.has_water,
    has_agent_fee: listing.has_agent_fee,
    wechat: listing.wechat,
    video_channel: listing.video_channel,
    field_visibility: visibility,
    updated_at: new Date().toISOString()
  };
}

async function upsert(row) {
  const response = await fetch(`${baseUrl}/rest/v1/listings?on_conflict=id`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) throw new Error(`写入房源失败 ${response.status} ${row.id}\n${await response.text()}`);
}

const selectedMedia = new Set(listings.flatMap((listing) => [...(listing.images || []), ...(listing.videos || [])]));
console.log(`准备导入 ${listings.length} 条房源，媒体 ${selectedMedia.size} 个${dryRun ? "（演练模式，不写入）" : ""}`);
const rows = [];
let index = 0;
for (const listing of listings) {
  index += 1;
  const imageUrls = [];
  for (const url of listing.images || []) {
    imageUrls.push(dryRun ? url : await uploadMedia(url));
  }
  const videoUrls = [];
  for (const url of listing.videos || []) {
    videoUrls.push(dryRun ? url : await uploadMedia(url));
  }
  rows.push(toRow(listing, imageUrls, videoUrls));
  if (index % 20 === 0 || index === listings.length) console.log(`已处理 ${index}/${listings.length}`);
}

if (!dryRun) {
  for (const row of rows) await upsert(row);
}

console.log(dryRun ? "演练完成，未写入任何数据。" : "导入完成。");
