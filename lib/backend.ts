export type LiveListing = {
  id: string;
  title: string;
  category: string;
  park: string | null;
  region?: '北部'|'中部'|'南部'|'生态园'|'大朗'|'寮步'|'大岭山'|'东城'|'南城'|null;
  unit: string | null;
  building?: string | null;
  room?: string | null;
  unit_split?: boolean;
  payment_terms?: string | null;
  has_agent_fee?: boolean | null;
  wechat?: string | null;
  video_channel?: string | null;
  has_crane_support?: boolean | null;
  freight_elevator_load?: string | null;
  freight_elevator_size?: string | null;
  has_passenger_elevator?: boolean | null;
  has_water?: boolean | null;
  field_visibility?: Partial<Record<'park'|'building'|'floor'|'room'|'address'|'coordinates'|'has_agent_fee'|'wechat'|'video_channel',boolean>>;
  floor: string | null;
  area: number | null;
  price: number | null;
  fee: number | null;
  facing: string | null;
  layout: string | null;
  decoration: string | null;
  description: string | null;
  free_rent_period?: string | null;
  supporting_facilities?: string | null;
  compatible_industries?: string | null;
  factory_height?: string | null;
  factory_load?: string | null;
  factory_power?: string | null;
  fire_rating?: string | null;
  environmental_requirements?: string | null;
  internal_code?: string | null;
  owner_floor_price?: number | null;
  channel_notes?: string | null;
  followup_notes?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  owner_contact_name?: string | null;
  owner_contact_phone?: string | null;
  tag?: string | null;
  views?: number;
  images: string[];
  videos: string[];
  status: "draft" | "published";
  withdrawn_at?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  first_published_at?: string | null;
};

export type PublicListing = Omit<LiveListing, "internal_code" | "owner_floor_price" | "owner_contact_name" | "owner_contact_phone" | "channel_notes" | "followup_notes" | "field_visibility" | "unit_split"> & { listing_code?: string | null };

export type Inquiry = {
  listing_id?: string | null;
  request_text?: string | null;
  company: string;
  contact: string;
  phone: string;
  viewing_at?: string | null;
};
export type SavedInquiry = Inquiry & { kind?: "inquiry" | "company" | "need"; details?: Record<string,string>; id: string; created_at: string; status?: "pending" | "replied" | "closed"; reply?: string; replied_at?: string | null; deleted_at?: string | null; visitor_withdrawn_at?: string | null };

type Session = { access_token: string; refresh_token: string; expires_at: number; user: { id: string; email?: string } };
const storageKey = "songshanhu_admin_session";
export const backendUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
export const backendKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
export const backendReady = Boolean(backendUrl && backendKey);

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(window.localStorage.getItem(storageKey) || "null"); } catch { return null; }
}
function saveSession(value: Session | null) {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(storageKey, JSON.stringify(value));
  else window.localStorage.removeItem(storageKey);
}
async function parseResponse(response: Response) {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.error_code || result?.code;
    const detail = result?.message || result?.msg || result?.error_description || result?.error || `请求失败 (${response.status})`;
    if (code === "invalid_credentials" || /invalid login credentials/i.test(detail)) throw new Error("邮箱或密码不正确。请使用本站管理员邮箱及为该用户设置的密码，不能使用 WorkBuddy 密码。");
    if (code === "email_not_confirmed") throw new Error("该邮箱尚未确认，请先完成邮箱确认。");
    if (response.status === 413 || /maximum allowed size|payload too large|exceeded.*size/i.test(detail)) throw new Error("文件超过当前云存储允许的单文件大小，请压缩后重新上传。");
    if (/row.level security|permission denied/i.test(detail)) throw new Error("云端拒绝了操作：当前账号的管理权限或数据访问规则需要检查。房源内容尚未保存。");
    if (response.status === 429) throw new Error("操作过于频繁，请稍后重试。");
    throw new Error(detail);
  }
  return result;
}
export async function signIn(email: string, password: string) {
  const response = await fetch(`${backendUrl}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: backendKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });
  const result = await parseResponse(response);
  const session: Session = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + result.expires_in * 1000, user: result.user };
  saveSession(session);
  return session;
}
export function signOut() { saveSession(null); }
export type AdminRole = "superadmin" | "content_admin" | "park_admin";
export type AdminProfile = { user_id: string; role: AdminRole; active: boolean; park?: string | null; display_name?: string };
export async function adminProfile(): Promise<AdminProfile | null> {
  const session = readSession();
  if (!session) return null;
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/admin_users?select=*&user_id=eq.${encodeURIComponent(session.user.id)}`, { headers: headers(token), cache: "no-store" });
  const rows = await parseResponse(response);
  return rows.find((row: AdminProfile) => row.active === true) || null;
}
export async function isAdmin(): Promise<boolean> { return Boolean(await adminProfile()); }
// Refresh once per tab: parallel dashboard requests must share the same token rotation.
let sessionRefresh: Promise<string> | null = null;
export async function accessToken(): Promise<string> {
  const current = readSession();
  if (!current) throw new Error("请先登录管理后台");
  if (current.expires_at > Date.now() + 60_000) return current.access_token;
  if (sessionRefresh) return sessionRefresh;
  sessionRefresh = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${backendUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST", headers: { apikey: backendKey, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh_token }), signal: controller.signal,
      });
      if ([400,401,403].includes(response.status)) {
        // Do not clear a newer sign-in established while this request was in flight.
        if (readSession()?.refresh_token === current.refresh_token) saveSession(null);
        throw new Error("登录已过期，请退出后重新登录管理后台。");
      }
      const result = await parseResponse(response);
      if (readSession()?.refresh_token !== current.refresh_token) {
        const latest = readSession();
        if (!latest) throw new Error("你已退出登录，请重新登录管理后台。");
        return latest.access_token;
      }
      const session: Session = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + result.expires_in * 1000, user: result.user };
      saveSession(session);
      return session.access_token;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("登录状态刷新超时，请检查网络后重试。尚未提交本次操作。");
      if (error instanceof TypeError) throw new Error("登录服务连接失败，请检查网络后重试。尚未提交本次操作。");
      throw error;
    } finally { clearTimeout(timer); }
  })();
  try { return await sessionRefresh; } finally { sessionRefresh = null; }
}

function headers(token?: string) { return { apikey: backendKey, Authorization: `Bearer ${token || backendKey}` }; }
export async function loadPublished(): Promise<PublicListing[]> {
  if (!backendReady) return [];
  const response = await fetch(`${backendUrl}/rest/v1/public_listings?select=*&order=created_at.desc`, { headers: headers(), cache: "no-store" });
  return parseResponse(response);
}
export async function getPublished(id: string): Promise<PublicListing | null> {
  if (!backendReady) return null;
  const response = await fetch(`${backendUrl}/rest/v1/public_listings?select=*&id=eq.${encodeURIComponent(id)}&limit=1`, { headers: headers(), cache: "no-store" });
  const rows = await parseResponse(response);
  return rows[0] || null;
}
export async function submitInquiry(inquiry: Inquiry, requestId: string) {
  if (!backendReady) throw new Error("线上预约服务尚未开通，请稍后再试。");
  const response = await fetch(`${backendUrl}/rest/v1/rpc/submit_site_inquiry`, {
    method: "POST", headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({p_payload:{...inquiry,request_text:inquiry.request_text || "希望安排看房，请联系我。",kind:"inquiry",consent:true,client_request_id:requestId}}),
    signal: AbortSignal.timeout(30000),
  });
  return parseResponse(response) as Promise<{id:string;receipt:string}>;
}
export async function loadInquiries(): Promise<SavedInquiry[]> {
  const token = await accessToken();
  const rows=new Map<string,SavedInquiry>();
  for(let offset=0;offset<10000;offset+=500){
    const response = await fetch(`${backendUrl}/rest/v1/inquiries?select=*&order=created_at.desc,id.desc&limit=500&offset=${offset}`, { headers: headers(token), cache: "no-store", signal: AbortSignal.timeout(20000) });
    const page:SavedInquiry[]=await parseResponse(response);
    if(!Array.isArray(page))throw new Error('留言返回格式异常，已有资料保留。');
    page.forEach(item=>rows.set(item.id,item));
    if(page.length<500)return Array.from(rows.values());
  }
  throw new Error('留言超过单次读取上限，未提供不完整的导出；请联系负责人增加服务端分页。');
}
export async function loadAll(): Promise<LiveListing[]> {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/listings?select=*&order=created_at.desc`, { headers: headers(token), cache: "no-store" });
  return parseResponse(response);
}
export async function saveListing(listing: LiveListing) {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/listings?on_conflict=id`, {
    method: "POST", headers: { ...headers(token), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(listing),
  });
  return parseResponse(response);
}
export async function deleteListing(id: string) {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: {...headers(token),"Content-Type":"application/json"}, body:JSON.stringify({deleted_at:new Date().toISOString(),status:"draft"}) });
  if (!response.ok) await parseResponse(response);
}
export async function uploadMedia(file: File, onProgress?: (percent: number) => void) {
  const token = await accessToken();
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const path = `${readSession()?.user.id}/${crypto.randomUUID()}.${extension}`;
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${backendUrl}/storage/v1/object/listing-media/${path}`);
    xhr.timeout = 300_000;
    Object.entries({ ...headers(token), "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" }).forEach(([name, value]) => xhr.setRequestHeader(name, value));
    onProgress?.(0);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(Math.min(99, Math.round(event.loaded / event.total * 100))); };
    xhr.onerror = () => reject(new Error("上传连接中断，请检查网络后重新选择该文件。"));
    xhr.ontimeout = () => reject(new Error("上传超时，请压缩文件或更换网络后重试。"));
    xhr.onabort = () => reject(new Error("上传已取消。"));
    xhr.onload = async () => {
      try {
        await parseResponse(new Response(xhr.responseText || null, { status: xhr.status }));
        onProgress?.(100); resolve();
      } catch (error) { reject(error); }
    };
    xhr.send(file);
  });
  return `${backendUrl}/storage/v1/object/public/listing-media/${path}`;
}
