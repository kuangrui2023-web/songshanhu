import type { CompanyInput } from "./companies";
import { excelDate } from "./sheet-read";

export const IMPORT_COLUMNS = [
  "企业名称", "所属园区", "楼栋", "房号", "所属行业", "经营状态", "成立日期",
  "注册资本(万元)", "参保人数", "法定代表人", "联系电话", "邮箱",
  "统一社会信用代码", "注册地址", "经营范围", "官网", "标签",
] as const;

const ALIASES: Record<string, string[]> = {
  name: ["企业名称", "公司名称", "企业名", "名称"],
  park: ["所属园区", "园区", "园区名称"],
  building: ["楼栋", "楼宇", "栋", "楼栋号"],
  room: ["房号", "房间号", "门牌"],
  industry: ["所属行业", "行业"],
  status: ["经营状态", "状态", "企业状态"],
  established_on: ["成立日期", "成立时间", "注册日期", "注册时间"],
  registered_capital: ["注册资本(万元)", "注册资本（万元）", "注册资本"],
  social_insurance_count: ["参保人数", "社保人数", "参保"],
  legal_representative: ["法定代表人", "法人", "法人代表"],
  phone: ["联系电话", "电话", "手机"],
  email: ["邮箱", "电子邮箱", "邮件"],
  unified_code: ["统一社会信用代码", "信用代码", "统一代码"],
  address: ["注册地址", "地址"],
  business_scope: ["经营范围"],
  website: ["官网", "网址", "网站"],
  tags: ["标签", "企业标签"],
  employee_band: ["人数区间", "人员规模"],
};

/** blocking=true 表示这一行不会导入；false 只是提醒，行照常导入但该字段留空 */
export type RowIssue = { row: number; field: string; message: string; blocking: boolean };

export type ParsedSheet = {
  companies: (CompanyInput & { __row: number })[];
  issues: RowIssue[];
  unknownHeaders: string[];
  /** 一个单元格里写了多个电话/邮箱、只保留了第一个的行数 */
  trimmedContacts: number;
};

function normalizeHeader(h: string) {
  return String(h || "").replace(/\s+/g, "").replace(/[（）]/g, (m) => (m === "（" ? "(" : ")"));
}

function mapHeaders(header: string[]) {
  const index: Record<string, number> = {};
  const unknown: string[] = [];
  header.forEach((raw, i) => {
    const key = normalizeHeader(raw);
    if (!key) return;
    const hit = Object.entries(ALIASES).find(([, list]) =>
      list.some((alias) => normalizeHeader(alias) === key)
    );
    if (hit) { if (!(hit[0] in index)) index[hit[0]] = i; }
    else unknown.push(raw);
  });
  return { index, unknown };
}

function cleanDate(value: string) {
  const v = String(value || "").trim();
  if (!v) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(v)) return excelDate(v);
  const m = v.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

function cleanNumber(value: string) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) && String(value).trim() !== "" ? n : null;
}

function splitTags(value: string) {
  return String(value || "").split(/[、,，;；|]/).map((s) => s.trim()).filter(Boolean);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 电话/邮箱列常见一格多个值，数据库只存一个，这里取第一个 */
function firstValue(value: string) {
  return splitTags(value)[0] || "";
}

export function parseCompanySheet(table: string[][], allowedParks: string[], sourceName: string): ParsedSheet {
  const issues: RowIssue[] = [];
  let trimmedContacts = 0;
  if (table.length < 2) {
    return { companies: [], issues: [{ row: 0, field: "文件", message: "表格里没有数据行。", blocking: true }], unknownHeaders: [], trimmedContacts };
  }
  const header = table[0].map((h) => String(h || ""));
  const { index, unknown } = mapHeaders(header);
  if (!("name" in index)) {
    return { companies: [], issues: [{ row: 1, field: "企业名称", message: "表头里找不到「企业名称」列。", blocking: true }], unknownHeaders: unknown, trimmedContacts };
  }

  const parkSet = new Set(allowedParks.map((p) => p.trim()).filter(Boolean));
  const seen = new Set<string>();
  const companies: (CompanyInput & { __row: number })[] = [];

  table.slice(1).forEach((cells, i) => {
    const rowNo = i + 2; // 1 是表头
    const get = (key: string) => (key in index ? String(cells[index[key]] ?? "").trim() : "");
    const name = get("name");
    if (!name) return; // 整行没名字：当作空行跳过
    if (name.length < 2) {
      issues.push({ row: rowNo, field: "企业名称", message: "名称少于 2 个字。", blocking: true });
      return;
    }
    const park = get("park") || null;
    if (park && parkSet.size && !parkSet.has(park)) {
      issues.push({ row: rowNo, field: "所属园区", message: `系统里没有「${park}」这个园区。`, blocking: true });
      return;
    }
    const key = `${(park || "").toLowerCase()}::${name.toLowerCase()}`;
    if (seen.has(key)) {
      issues.push({ row: rowNo, field: "企业名称", message: "本文件内与前面的行重复。", blocking: true });
      return;
    }
    seen.add(key);

    const emailRaw = get("email");
    const phoneRaw = get("phone");
    const email = splitTags(emailRaw).find((e) => EMAIL_RE.test(e)) || "";
    if (emailRaw && !email) {
      issues.push({ row: rowNo, field: "邮箱", message: `「${firstValue(emailRaw)}」不像是有效邮箱，这一列留空。`, blocking: false });
    }
    const phone = firstValue(phoneRaw);
    if (splitTags(emailRaw).length > 1 || splitTags(phoneRaw).length > 1) trimmedContacts++;

    companies.push({
      __row: rowNo,
      name,
      park,
      building: get("building") || null,
      room: get("room") || null,
      industry: get("industry") || null,
      status: get("status") || "存续",
      established_on: cleanDate(get("established_on")),
      registered_capital: cleanNumber(get("registered_capital")),
      employee_band: get("employee_band") || null,
      legal_representative: get("legal_representative") || null,
      social_insurance_count: cleanNumber(get("social_insurance_count")),
      unified_code: get("unified_code") || null,
      phone: phone || null,
      email: email || null,
      address: get("address") || null,
      business_scope: get("business_scope") || null,
      website: get("website") || null,
      tags: splitTags(get("tags")),
      source: sourceName,
      published: true,
    });
  });

  return { companies, issues, unknownHeaders: unknown, trimmedContacts };
}

export function companyCsvRows(list: CompanyInput[]): string[][] {
  return list.map((c) => [
    c.name, c.park || "", c.building || "", c.room || "", c.industry || "", c.status || "",
    c.established_on || "", c.registered_capital == null ? "" : String(c.registered_capital),
    c.social_insurance_count == null ? "" : String(c.social_insurance_count),
    c.legal_representative || "", c.phone || "", c.email || "", c.unified_code || "",
    c.address || "", c.business_scope || "", c.website || "", (c.tags || []).join("、"),
  ]);
}
