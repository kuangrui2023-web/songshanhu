import { accessToken, backendReady, backendUrl, headers, parseResponse } from "./backend";

export type Company = {
  id: string;
  name: string;
  park: string | null;
  building: string | null;
  room: string | null;
  industry: string | null;
  status: string | null;
  established_on: string | null;
  registered_capital: number | null;
  employee_band: string | null;
  legal_representative: string | null;
  social_insurance_count: number | null;
  unified_code: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  business_scope: string | null;
  website: string | null;
  tags: string[];
  source: string | null;
  published: boolean;
  created_at?: string;
  updated_at?: string;
};

export type CompanyInput = Omit<Company, "id" | "created_at" | "updated_at"> & { id?: string };

export function blankCompany(park: string | null): CompanyInput {
  return {
    name: "", park, building: null, room: null, industry: null, status: "存续",
    established_on: null, registered_capital: null, employee_band: null,
    legal_representative: null, social_insurance_count: null, unified_code: null,
    phone: null, email: null, address: null, business_scope: null, website: null,
    tags: [], source: null, published: true,
  };
}

const text = (value: unknown, max: number) => {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
};

/** 把界面/导入的松散数据整理成可写入数据库的形状 */
export function normalizeCompany(input: CompanyInput): CompanyInput {
  return {
    ...input,
    name: String(input.name || "").trim().slice(0, 200),
    park: text(input.park, 120),
    building: text(input.building, 60),
    room: text(input.room, 60),
    industry: text(input.industry, 120),
    status: text(input.status, 40),
    established_on: /^\d{4}-\d{2}-\d{2}$/.test(String(input.established_on || "")) ? input.established_on : null,
    registered_capital: Number.isFinite(Number(input.registered_capital)) && input.registered_capital !== null && String(input.registered_capital) !== ""
      ? Number(input.registered_capital) : null,
    employee_band: text(input.employee_band, 40),
    legal_representative: text(input.legal_representative, 60),
    social_insurance_count: Number.isFinite(Number(input.social_insurance_count)) && input.social_insurance_count !== null && String(input.social_insurance_count) !== ""
      ? Math.max(0, Math.round(Number(input.social_insurance_count))) : null,
    unified_code: text(input.unified_code, 32),
    phone: text(input.phone, 40),
    email: text(input.email, 120),
    address: text(input.address, 300),
    business_scope: text(input.business_scope, 4000),
    website: text(input.website, 200),
    tags: Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20) : [],
    source: text(input.source, 200),
    published: input.published !== false,
  };
}

export async function loadCompanies(): Promise<Company[]> {
  if (!backendReady) return [];
  const token = await accessToken();
  const response = await fetch(
    `${backendUrl}/rest/v1/companies?select=*&order=updated_at.desc&limit=2000`,
    { headers: headers(token), cache: "no-store" },
  );
  return parseResponse(response);
}

export async function saveCompany(input: CompanyInput): Promise<Company> {
  const token = await accessToken();
  const row = { ...normalizeCompany(input), id: input.id || crypto.randomUUID() };
  const response = await fetch(`${backendUrl}/rest/v1/companies?on_conflict=id`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  const rows = await parseResponse(response);
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function deleteCompany(id: string) {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/companies?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!response.ok) await parseResponse(response);
}

export async function saveCompanies(list: CompanyInput[]): Promise<Company[]> {
  if (!list.length) return [];
  const token = await accessToken();
  const rows = list.map((item) => ({ ...normalizeCompany(item), id: item.id || crypto.randomUUID() }));
  const response = await fetch(`${backendUrl}/rest/v1/companies?on_conflict=id`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  return parseResponse(response);
}

/** 判断两行是不是同一家企业：只比较园区 + 企业名称（去空格、忽略大小写） */
export function companyKey(name: string, park: string | null) {
  return `${String(park || "").trim().toLowerCase()}::${String(name || "").trim().toLowerCase()}`;
}

/** 快查只返回查到的字段；没查到的键不出现，避免误覆盖已有内容。 */
export type CompanyLookupFields = Partial<Pick<CompanyInput,
  "name" | "unified_code" | "legal_representative" | "registered_capital" | "established_on" |
  "status" | "address" | "industry" | "business_scope" | "social_insurance_count">>;

export type CompanyLookupResult = {
  company: CompanyLookupFields;
  matched_name: string | null;
  source: "kuaicha";
  lookup_at: string;
};

/** 后台专用：经 Supabase Edge Function 调快查，密钥不会出现在浏览器。 */
export async function lookupCompany(name: string): Promise<CompanyLookupResult> {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/functions/v1/company-lookup`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
    signal: AbortSignal.timeout(35_000),
  });
  return parseResponse(response) as Promise<CompanyLookupResult>;
}
