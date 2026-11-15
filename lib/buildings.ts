import { accessToken, backendReady, backendUrl, headers, parseResponse } from "./backend";

/** 楼栋导览：一栋楼 + 楼内空置/预留单元。企业归属楼栋和楼层仍写在 companies 表。 */
export type Building = {
  id: string;
  name: string;
  region: string | null;
  address: string | null;
  floors_count: number | null;
  cover_url: string | null;
  description: string | null;
  highlights: string[];
  sort_order: number;
  published: boolean;
  /** 楼栋负责人（building_admin 的 user_id）；只有超级管理员能调整。 */
  manager_id: string | null;
  created_at?: string;
  updated_at?: string;
};

export type BuildingInput = Omit<Building, "id" | "created_at" | "updated_at"> & { id?: string };

export type BuildingUnit = {
  id: string;
  building_id: string;
  floor: string;
  floor_no: number | null;
  room: string | null;
  area: number | null;
  rent: number | null;
  fee: number | null;
  orientation: string | null;
  decoration: string | null;
  status: "vacant" | "reserved" | "occupied";
  note: string | null;
  sort_order: number;
  published: boolean;
  created_at?: string;
  updated_at?: string;
};

export type BuildingUnitInput = Omit<BuildingUnit, "id" | "created_at" | "updated_at"> & { id?: string };

const text = (value: unknown, max: number) => {
  const s = String(value ?? "").trim();
  return s ? s.slice(0, max) : null;
};
const numberOrNull = (value: unknown, min = 0) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, n) : null;
};

const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function cnNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === "十") return 10;
  const m = value.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
  if (value.length === 1 && value in CN_NUM) return CN_NUM[value];
  return null;
}

/** 把 12F / 12楼 / 十二层 / B1 / 负一层 解析成用于排序的整数。 */
export function parseFloorNo(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return null;
  if (/^(首层|地面层|大堂层)$/.test(raw)) return 1;
  const basement = raw.match(/^(?:B|负|地下)(.+)$/);
  if (basement) {
    const n = cnNumber(basement[1].replace(/[层楼F]$/, ""));
    return n === null ? null : -n;
  }
  const digits = raw.match(/-?\d+/);
  if (digits) return Number(digits[0]);
  const cn = cnNumber(raw.replace(/[层楼F]$/, ""));
  return cn;
}

export function floorText(no: number | null): string {
  if (no === null) return "";
  return no < 0 ? `B${Math.abs(no)}` : `${no}F`;
}

export function blankBuilding(): BuildingInput {
  return {
    name: "", region: null, address: null, floors_count: null, cover_url: null,
    description: null, highlights: [], sort_order: 0, published: false, manager_id: null,
  };
}

export function blankUnit(buildingId: string): BuildingUnitInput {
  return {
    building_id: buildingId, floor: "1F", floor_no: 1, room: null, area: null,
    rent: null, fee: null, orientation: null, decoration: null, status: "vacant",
    note: null, sort_order: 0, published: true,
  };
}

export function normalizeBuilding(input: BuildingInput): BuildingInput {
  return {
    ...input,
    name: String(input.name || "").trim().slice(0, 120),
    region: text(input.region, 120),
    address: text(input.address, 300),
    floors_count: input.floors_count === null || input.floors_count === undefined || String(input.floors_count) === ""
      ? null : Math.min(200, Math.max(1, Math.round(Number(input.floors_count)))),
    cover_url: text(input.cover_url, 1000),
    description: text(input.description, 4000),
    highlights: Array.isArray(input.highlights) ? input.highlights.map((s) => String(s).trim()).filter(Boolean).slice(0, 20) : [],
    sort_order: Number.isFinite(Number(input.sort_order)) ? Math.round(Number(input.sort_order)) : 0,
    published: input.published !== false,
  };
}

export function normalizeUnit(input: BuildingUnitInput): BuildingUnitInput {
  const floor = String(input.floor || "").trim().slice(0, 30) || "1F";
  return {
    ...input,
    floor,
    floor_no: parseFloorNo(floor),
    room: text(input.room, 60),
    area: numberOrNull(input.area),
    rent: numberOrNull(input.rent),
    fee: numberOrNull(input.fee),
    orientation: text(input.orientation, 30),
    decoration: text(input.decoration, 60),
    status: input.status === "occupied" || input.status === "reserved" ? input.status : "vacant",
    note: text(input.note, 1000),
    sort_order: Number.isFinite(Number(input.sort_order)) ? Math.round(Number(input.sort_order)) : 0,
    published: input.published !== false,
  };
}

export async function loadBuildings(): Promise<Building[]> {
  if (!backendReady) return [];
  const token = await accessToken();
  const response = await fetch(
    `${backendUrl}/rest/v1/buildings?select=*&order=sort_order.asc,name.asc&limit=500`,
    { headers: headers(token), cache: "no-store" },
  );
  return parseResponse(response);
}

export async function saveBuilding(input: BuildingInput): Promise<Building> {
  const token = await accessToken();
  const normalized = normalizeBuilding(input);
  // 编辑用 PATCH，而不是 upsert：楼栋管理员没有“新建楼栋”权限，
  // upsert 会先检查 INSERT 策略，导致他们连自己负责的楼栋也保存不了。
  if (input.id) {
    const body: Record<string, unknown> = { ...normalized };
    delete body.id;
    const response = await fetch(`${backendUrl}/rest/v1/buildings?id=eq.${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { ...headers(token), "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const rows = await parseResponse(response);
    if (!Array.isArray(rows) || !rows.length) throw new Error("保存未完成：没有这栋楼的管理权限，请刷新后重试。");
    return rows[0];
  }
  const row = { ...normalized, id: crypto.randomUUID() };
  const response = await fetch(`${backendUrl}/rest/v1/buildings`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const rows = await parseResponse(response);
  if (!Array.isArray(rows) || !rows.length) throw new Error("新建未完成：只有超级管理员和全园区管理员可以新增楼栋。");
  return rows[0];
}

export async function deleteBuilding(id: string) {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/buildings?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!response.ok) await parseResponse(response);
}

export async function loadBuildingUnits(buildingId?: string): Promise<BuildingUnit[]> {
  if (!backendReady) return [];
  const token = await accessToken();
  const filter = buildingId ? `&building_id=eq.${encodeURIComponent(buildingId)}` : "";
  const response = await fetch(
    `${backendUrl}/rest/v1/building_units?select=*&order=floor_no.desc.nullslast,room.asc&limit=5000${filter}`,
    { headers: headers(token), cache: "no-store" },
  );
  return parseResponse(response);
}

export async function saveBuildingUnit(input: BuildingUnitInput): Promise<BuildingUnit> {
  const token = await accessToken();
  const row = { ...normalizeUnit(input), id: input.id || crypto.randomUUID() };
  const response = await fetch(`${backendUrl}/rest/v1/building_units?on_conflict=id`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  const rows = await parseResponse(response);
  return Array.isArray(rows) ? rows[0] : rows;
}

export async function saveBuildingUnits(list: BuildingUnitInput[]): Promise<BuildingUnit[]> {
  if (!list.length) return [];
  const token = await accessToken();
  const rows = list.map((item) => ({ ...normalizeUnit(item), id: item.id || crypto.randomUUID() }));
  const response = await fetch(`${backendUrl}/rest/v1/building_units?on_conflict=id`, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  return parseResponse(response);
}

export async function deleteBuildingUnit(id: string) {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/building_units?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!response.ok) await parseResponse(response);
}

export async function deleteBuildingUnitsOfBuilding(buildingId: string) {
  const token = await accessToken();
  const response = await fetch(`${backendUrl}/rest/v1/building_units?building_id=eq.${encodeURIComponent(buildingId)}`, {
    method: "DELETE",
    headers: headers(token),
  });
  if (!response.ok) await parseResponse(response);
}

/** 同一栋楼内判定重复：同楼层 + 同房号（空房号按整层算）。 */
export function unitKey(floor: string, room: string | null) {
  return `${String(floor || "").trim().toLowerCase()}::${String(room || "").trim().toLowerCase()}`;
}
