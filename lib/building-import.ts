import type { BuildingUnitInput } from "./buildings";
import { normalizeUnit, unitKey } from "./buildings";
import type { RowIssue } from "./company-import";

export const UNIT_IMPORT_COLUMNS = [
  "楼层", "房号", "面积(㎡)", "租金(元/㎡·月)", "物业费(元/㎡·月)",
  "朝向", "装修", "状态", "备注",
] as const;

const ALIASES: Record<string, string[]> = {
  floor: ["楼层", "所在楼层", "层数", "层"],
  room: ["房号", "房间号", "单元", "门牌"],
  area: ["面积(㎡)", "面积（㎡）", "面积", "建筑面积"],
  rent: ["租金(元/㎡·月)", "租金（元/㎡·月）", "租金单价", "租金", "单价"],
  fee: ["物业费(元/㎡·月)", "物业费（元/㎡·月）", "物业费", "管理费"],
  orientation: ["朝向", "方向"],
  decoration: ["装修", "装修情况", "交付标准"],
  status: ["状态", "出租状态", "单元状态"],
  note: ["备注", "说明", "补充说明"],
};

export type ParsedUnitSheet = {
  units: (BuildingUnitInput & { __row: number })[];
  issues: RowIssue[];
  unknownHeaders: string[];
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
    const hit = Object.entries(ALIASES).find(([, list]) => list.some((alias) => normalizeHeader(alias) === key));
    if (hit) { if (!(hit[0] in index)) index[hit[0]] = i; }
    else unknown.push(raw);
  });
  return { index, unknown };
}

function cleanNumber(value: string) {
  const s = String(value || "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function statusOf(value: string): BuildingUnitInput["status"] {
  const s = String(value || "").trim();
  if (/预留|已定|洽谈|锁定|预定/.test(s)) return "reserved";
  if (/已租|出租|在租|占用|已有企业/.test(s)) return "occupied";
  return "vacant";
}

export function parseUnitSheet(table: string[][], buildingId: string): ParsedUnitSheet {
  const issues: RowIssue[] = [];
  if (table.length < 2) {
    return { units: [], issues: [{ row: 0, field: "文件", message: "表格里没有数据行。", blocking: true }], unknownHeaders: [] };
  }
  const header = table[0].map((h) => String(h || ""));
  const { index, unknown } = mapHeaders(header);
  if (!("floor" in index)) {
    return { units: [], issues: [{ row: 1, field: "楼层", message: "表头里找不到「楼层」列。", blocking: true }], unknownHeaders: unknown };
  }

  const seen = new Set<string>();
  const units: (BuildingUnitInput & { __row: number })[] = [];

  table.slice(1).forEach((cells, i) => {
    const rowNo = i + 2;
    const get = (key: string) => (key in index ? String(cells[index[key]] ?? "").trim() : "");
    const floor = get("floor");
    const room = get("room");
    if (!floor && !room && !get("area")) return; // 空行
    if (!floor) {
      issues.push({ row: rowNo, field: "楼层", message: "楼层不能为空，这一行不会导入。", blocking: true });
      return;
    }
    if (room) {
      const key = unitKey(floor, room);
      if (seen.has(key)) {
        issues.push({ row: rowNo, field: "房号", message: "本文件内与前面的行楼层、房号重复，这一行不会导入。", blocking: true });
        return;
      }
      seen.add(key);
    }
    const area = cleanNumber(get("area"));
    if (get("area") && area === null) {
      issues.push({ row: rowNo, field: "面积", message: `「${get("area")}」不是有效数字，面积留空。`, blocking: false });
    }
    units.push({
      __row: rowNo,
      building_id: buildingId,
      floor,
      floor_no: null,
      room: room || null,
      area,
      rent: cleanNumber(get("rent")),
      fee: cleanNumber(get("fee")),
      orientation: get("orientation") || null,
      decoration: get("decoration") || null,
      status: statusOf(get("status")),
      note: get("note") || null,
      sort_order: 0,
      published: true,
    });
  });

  return { units: units.map((unit) => ({ ...normalizeUnit(unit), __row: unit.__row })), issues, unknownHeaders: unknown };
}

export function unitCsvRows(list: BuildingUnitInput[]): string[][] {
  const statusText = (status: BuildingUnitInput["status"]) => status === "occupied" ? "已租" : status === "reserved" ? "预留" : "空置";
  return list.map((unit) => [
    unit.floor, unit.room || "", unit.area == null ? "" : String(unit.area),
    unit.rent == null ? "" : String(unit.rent), unit.fee == null ? "" : String(unit.fee),
    unit.orientation || "", unit.decoration || "", statusText(unit.status), unit.note || "",
  ]);
}
