import { strFromU8, unzipSync } from "fflate";

/**
 * 读取 .xlsx / .csv 为二维字符串表格。
 * .xlsx 本质是 zip，用项目里已有的 fflate 解压后解析 XML，不引入第三方库。
 */

export type SheetTable = {
  sheetName: string;
  rows: string[][]; // 第一行通常是表头
  skippedSheets: string[];
};

export async function readTableFile(file: File): Promise<SheetTable> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await readTextSmart(file);
    const rows = parseCsv(text);
    return { sheetName: file.name, rows, skippedSheets: [] };
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    return readXlsx(await file.arrayBuffer());
  }
  if (name.endsWith(".xls")) {
    throw new Error("不支持旧版 .xls，请在 Excel 里另存为 .xlsx 或 .csv。");
  }
  throw new Error("只支持 .xlsx 和 .csv 文件。");
}

async function readTextSmart(file: File) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  // 中文 Windows 下 Excel 另存的 CSV 常见是 GBK；UTF-8 解出来会出现替换字符
  if (utf8.includes("�")) {
    try { return new TextDecoder("gbk").decode(buffer); } catch { /* 浏览器不支持 gbk 时退回 utf-8 */ }
  }
  return utf8.replace(/^﻿/, "");
}

/** RFC 4180 风格的 CSV 解析，支持引号、逗号、换行 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function readXlsx(buffer: ArrayBuffer): SheetTable {
  const files = unzipSync(new Uint8Array(buffer));
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : "");
  const parser = new DOMParser();
  const xml = (path: string) => {
    const text = read(path);
    if (!text) return null;
    const doc = parser.parseFromString(text, "application/xml");
    return doc.querySelector("parsererror") ? null : doc;
  };

  const workbook = xml("xl/workbook.xml");
  if (!workbook) throw new Error("文件不是有效的 .xlsx，请用 Excel 重新另存后再试。");

  const sheets = Array.from(workbook.querySelectorAll("sheet"));
  const firstSheetName = sheets[0]?.getAttribute("name") || "Sheet1";
  const relId = sheets[0]?.getAttribute("r:id") || "rId1";

  const rels = xml("xl/_rels/workbook.xml.rels");
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rel = rels && Array.from(rels.querySelectorAll("Relationship")).find((r) => r.getAttribute("Id") === relId);
  if (rel) {
    const target = rel.getAttribute("Target") || "";
    sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  }
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error("没有读到工作表内容，请确认文件没有加密或损坏。");

  const shared = parseSharedStrings(read("xl/sharedStrings.xml"));
  const rows: string[][] = [];
  for (const row of Array.from(sheet.querySelectorAll("sheetData > row"))) {
    const cells: string[] = [];
    for (const c of Array.from(row.querySelectorAll("c"))) {
      const ref = c.getAttribute("r") || "";
      const index = columnIndex(ref);
      const type = c.getAttribute("t");
      let value = "";
      if (type === "inlineStr") {
        value = Array.from(c.querySelectorAll("is t")).map((t) => t.textContent || "").join("");
      } else {
        const v = c.querySelector("v")?.textContent ?? "";
        value = type === "s" ? shared[Number(v)] ?? "" : v;
      }
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }
    if (cells.some((v) => v.trim() !== "")) rows.push(cells);
  }

  return {
    sheetName: firstSheetName,
    rows,
    skippedSheets: sheets.slice(1).map((s) => s.getAttribute("name") || ""),
  };
}

function columnIndex(ref: string) {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function parseSharedStrings(text: string) {
  if (!text) return [] as string[];
  const doc = new DOMParser().parseFromString(text, "application/xml");
  return Array.from(doc.querySelectorAll("si")).map((si) =>
    Array.from(si.querySelectorAll("t")).map((t) => t.textContent || "").join("")
  );
}

/** Excel 的日期是「1900 年起的序列号」，这里换算成 2020-05-01 这种格式 */
export function excelDate(value: string): string {
  const n = Number(value);
  if (!value || !Number.isFinite(n) || n < 20000 || n > 80000) return value;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
