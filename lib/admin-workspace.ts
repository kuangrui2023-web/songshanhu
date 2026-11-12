import { accessToken, backendKey, backendUrl, type AdminRole } from "./backend";
import type { VisitorSummary, VisitRecord, VisitPage } from './visitor-analytics';

export const ALL_PARKS_SCOPE = "__all_parks__";
export const adminRoleLabel = (role: AdminRole) => role === "superadmin" ? "超级管理员" : role === "content_admin" ? "全园区管理员" : "园区管理员";

export type Park = { id: string; name: string; address: string; latitude: number | null; longitude: number | null; contact_name: string; contact_phone: string; description: string; active: boolean };
export type SiteSettings = { platform_name: string; hotline: string; admin_limit: number; share_title: string; share_description: string; share_image: string };
export type AdminEntry = { user_id: string; display_name: string; email: string; role: AdminRole; park: string | null; active: boolean; created_at: string; last_sign_in_at: string | null };
export type Metrics = { visitors: number; views: number; today_visitors: number; today_views: number; since: string | null; trend: { day: string; visitors: number; views: number }[]; top: { id: string; title: string; views: number }[] };
export const defaultSettings: SiteSettings = { platform_name: "松山湖产业招商", hotline: "", admin_limit: 5, share_title: "", share_description: "", share_image: "" };

export class WorkspaceError extends Error {
  constructor(message: string, public code: string = "") { super(message); this.name = "WorkspaceError"; }
}
export async function workspaceRequest<T>(path: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), path.includes("/functions/") ? 45000 : 25000);
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { apikey: backendKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      const code = String(data?.code || "");
      if (response.status === 401) throw new WorkspaceError("登录已过期，请退出后重新登录后台，再提交操作。", code);
      if (["PGRST202", "PGRST205", "42P01", "42703"].includes(code)) throw new WorkspaceError("后台云端功能尚未升级，请联系网站负责人完成更新。", code);
      throw new WorkspaceError(data?.message || data?.error || `操作未完成（${response.status}），请稍后重试。`, code);
    }
    return data as T;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new WorkspaceError("云端响应超时，操作结果暂未确认。请先刷新后台列表核对，避免重复提交。", "OPERATION_UNCONFIRMED");
    if (error instanceof SyntaxError) throw new WorkspaceError("云端返回了异常内容，结果暂未确认。请刷新列表核对后再操作。", "OPERATION_UNCONFIRMED");
    throw new WorkspaceError("未能连接云端，操作结果暂未确认。填写内容已保留，请检查网络并刷新列表核对。", "OPERATION_UNCONFIRMED");
  } finally { clearTimeout(timer); }
}
export const loadParks = () => workspaceRequest<Park[]>("/rest/v1/parks?select=*&order=name.asc");
export async function loadSettings() { const rows = await workspaceRequest<SiteSettings[]>("/rest/v1/site_settings?select=*&id=eq.true"); return rows[0] || defaultSettings; }
export const loadDirectory = () => workspaceRequest<AdminEntry[]>("/rest/v1/rpc/site_admin_directory", {});
export const loadMetrics = () => workspaceRequest<Metrics>("/rest/v1/rpc/site_admin_metrics", {});
export const loadVisitorPage = (page:number) => workspaceRequest<VisitPage<VisitorSummary>>("/rest/v1/rpc/site_admin_visit_details", {p_visitor:null,p_page:page,p_page_size:20});
export const loadVisitorHistory = (visitor:string,page:number) => workspaceRequest<VisitPage<VisitRecord>>("/rest/v1/rpc/site_admin_visit_details", {p_visitor:visitor,p_page:page,p_page_size:20});
export const savePark = (park: Park) => workspaceRequest<Park>("/rest/v1/rpc/save_site_park", { p_park: park });
export const saveSettings = (settings: SiteSettings) => workspaceRequest<SiteSettings>("/rest/v1/rpc/save_site_settings", { p_settings: settings });
export const saveInquiry = (id: string, status: string, reply: string, archived = false) => workspaceRequest<void>("/rest/v1/rpc/manage_site_inquiry", { p_id: id, p_status: status, p_reply: reply, p_archived: archived });
export const manageAdmin = (action: string, entry: Partial<AdminEntry>) => workspaceRequest<string>("/rest/v1/rpc/manage_site_admin", { p_action: action, p_email: entry.email || null, p_user: entry.user_id || null, p_name: entry.display_name || "", p_park: entry.role === "content_admin" ? ALL_PARKS_SCOPE : entry.park || null, p_active: entry.active ?? true });
export const createAdminAccount = (entry: {email: string; password: string; name: string; park: string}) => workspaceRequest<{id: string}>("/functions/v1/admin-accounts", entry);
export const checkAdminService = () => workspaceRequest<{ready:boolean}>("/functions/v1/admin-accounts", {action:"check"});
export async function changeOwnPassword(password: string) {
  const token = await accessToken();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
  try {
    const response = await fetch(`${backendUrl}/auth/v1/user`, { method: "PUT", headers: { apikey: backendKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ password }),signal:controller.signal });
    const data = await response.json();
    if (!response.ok) throw new WorkspaceError(response.status===401?"登录已过期，请重新登录后修改密码。":data?.msg || data?.message || "密码修改未完成，请重新登录后再试。");
  } catch(error) {
    if(error instanceof WorkspaceError)throw error;
    throw new WorkspaceError("密码修改结果暂未确认，请先使用新密码核对登录，避免重复修改。");
  } finally {clearTimeout(timer);}
}
export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const csv = "\uFEFF" + [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const importListingNote=(listing:import('./backend').LiveListing,mode:'check'|'draft'|'published'='check')=>workspaceRequest<import('./listing-import-runner').ImportResult>('/rest/v1/rpc/site_import_listing_note',{p_request:listing.id,p_listing:listing,p_mode:mode});
