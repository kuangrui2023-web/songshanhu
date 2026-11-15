/**
 * 快查园区企业名录抓取脚本
 *
 * 原理：快查网页版用浏览器 Cookie 鉴权。本脚本不保存、不传输出任何账号密码，
 *      只连接你自己登录过的 Chrome（调试端口），在页面上下文里调用它的 JSON 接口。
 *
 * 用法：
 *   node scripts/scrape-kuaicha.mjs --list "松山湖"          # 只搜园区，不抓企业
 *   node scripts/scrape-kuaicha.mjs --parks "松山湖天安云谷,松山湖台湾高科技园"
 *   node scripts/scrape-kuaicha.mjs --codes "YQ0098348,YQ0023567"
 *
 * 可选参数：
 *   --out <文件>     输出 CSV 路径（默认 exports/快查企业名录-<时间>.csv）
 *   --delay <毫秒>   每次请求间隔（默认 3000，不建议低于 2000）
 *   --park <名称>    CSV 里「所属园区」统一写成这个值（用于对齐你网站的园区名）
 *   --building <名>  CSV 里「楼栋」统一写成这个值（例：天安云谷）
 *   --port <端口>    Chrome 调试端口（默认 9224）
 *
 * 注意：抓取结果只包含快查「园区企业列表」接口公开返回的字段，不含参保人数。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const PORT = Number(args.port || 9224);
const DELAY = Math.max(Number(args.delay || 3000), 1000);
const SITE = "https://www.kuaicha365.com/outer/park-home";
const CHROME_PATHS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(3000) });
  return res.json();
}

async function ensureBrowser() {
  for (let i = 0; i < 3; i++) {
    try { await cdpTargets(); return; } catch { /* not up yet */ }
    await sleep(1000);
  }
  const chrome = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error("没找到 Chrome，请先安装或手动用 --port 指定已开的调试端口。");
  const profile = path.join(os.tmpdir(), "kc-profile");
  spawn(chrome, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    SITE,
  ], { detached: true, stdio: "ignore" }).unref();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    try { await cdpTargets(); return; } catch { /* keep waiting */ }
  }
  throw new Error(
    "Chrome 调试端口没起来。可能已经有一个用同一配置目录打开的 Chrome 在跑：请把它全部关掉再重试。"
  );
}

async function connect() {
  const targets = await cdpTargets();
  let page = targets.find((t) => t.type === "page" && /kuaicha365\.com/.test(t.url));
  if (!page) page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("浏览器里没有可用的标签页。");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || m.error); pending.delete(m.id); }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params = {}) => new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });

  // 确保当前页在快查域名下，fetch 才能带上登录 Cookie
  const url = await send("Runtime.evaluate", { expression: "location.href", returnByValue: true });
  const href = String(url.result?.value || "");
  if (!/kuaicha365\.com/.test(href)) {
    await send("Page.navigate", { url: SITE });
    await sleep(5000);
  }
  return { ws, send };
}

async function evalInPage(send, expression) {
  const res = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (res.exceptionDetails) {
    throw new Error("页面脚本报错：" + (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
  }
  return res.result?.value;
}

/** 在页面里 POST 一个快查接口，返回解析后的 JSON（失败抛错） */
async function postApi(send, apiPath, body) {
  const expr = `(async () => {
    const r = await fetch(${JSON.stringify(apiPath)}, {
      method: "POST",
      headers: { "Content-Type": "application/json", "accept": "application/json", "source": "PC" },
      body: ${JSON.stringify(JSON.stringify(body))}
    });
    return await r.text();
  })()`;
  const text = await evalInPage(send, expr);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`接口返回不是 JSON：${String(text).slice(0, 200)}`); }
  if (json.status_code !== 0) throw new Error(`接口 ${apiPath} 报错：${json.status_code} ${json.status_msg}`);
  return json.data;
}

/** 在页面里 GET 一个快查接口 */
async function getApi(send, apiPath) {
  const expr = `(async () => {
    const r = await fetch(${JSON.stringify(apiPath)}, {
      headers: { "accept": "application/json", "source": "PC" }
    });
    return await r.text();
  })()`;
  const text = await evalInPage(send, expr);
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`接口返回不是 JSON：${String(text).slice(0, 200)}`); }
  if (json.status_code !== 0) throw new Error(`接口 ${apiPath} 报错：${json.status_code} ${json.status_msg}`);
  return json.data;
}

async function parkDetail(send, code) {
  return getApi(send, `/open/sales/v1/park/detail?park_code=${encodeURIComponent(code)}`);
}

async function searchParks(send, keyword) {
  const data = await postApi(send, "/open/sales/v1/park/search", {
    export: false, query: keyword, page_size: 50, page: 1,
  });
  return (data?.list || []).map((p) => ({
    code: p.park_code,
    name: p.park_name,
    enter: p.enter_num,
  }));
}

async function listParkCompanies(send, park) {
  const rows = [];
  let page = 1;
  let total = null;
  while (true) {
    const data = await postApi(send, "/open/sales/v1/park/enter_search", {
      page, page_size: 100, query: "",
      condition: [{ label: "园区", value: "park_code", list: [{ value: park.code }] }],
    });
    if (total == null) total = Number(data?.total || 0);
    const list = data?.list || [];
    rows.push(...list);
    process.stdout.write(`\r  ${park.name}：已取 ${rows.length}/${total} 家`);
    if (!list.length || rows.length >= total) break;
    page += 1;
    await sleep(DELAY + Math.floor(Math.random() * 700));
  }
  process.stdout.write("\n");
  return rows;
}

const CSV_HEADER = [
  "企业名称", "所属园区", "楼栋", "房号", "所属行业", "经营状态", "成立日期",
  "注册资本(万元)", "参保人数", "法定代表人", "联系电话", "邮箱",
  "统一社会信用代码", "注册地址", "经营范围", "官网", "标签",
];

function dateFromUnix(sec) {
  if (!sec) return "";
  const d = new Date(Number(sec) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function joinList(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join("、");
  return v ? String(v) : "";
}

/** 防止 CSV 公式注入：以 = + - @ 开头的单元格加前导单引号 */
function cell(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, parkLabel, buildingLabel) {
  const lines = [CSV_HEADER.join(",")];
  for (const c of rows) {
    const tags = [...(c.smes_type || []), ...(c.listed_tag_value || [])].filter(Boolean);
    if (c.high_tech && !tags.includes("高新技术企业")) tags.push("高新技术企业");
    lines.push([
      c.name, parkLabel || c.__park, buildingLabel || "", "", c.industry, c.state, dateFromUnix(c.establish_time),
      c.capital_rmb ?? "", "", c.legal_person, joinList(c.phone_num), joinList(c.e_mail),
      c.unified_social_credit_code, c.address, "", c.host || "", tags.join("、"),
    ].map(cell).join(","));
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((c) => {
    const key = c.unified_social_credit_code || c.org_id || c.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  if (args["from-json"]) {
    // 不联网：把之前抓的原始 JSON 重新输出成 CSV，可顺便改园区/楼栋
    const src = String(args["from-json"]);
    const rows = dedupe(JSON.parse(fs.readFileSync(src, "utf8")));
    const out = args.out || src.replace(/\.json$/i, ".csv");
    fs.writeFileSync(out, toCsv(rows, args.park ? String(args.park) : "", args.building ? String(args.building) : ""), "utf8");
    console.log(`已转换 ${rows.length} 条 → ${out}`);
    return;
  }

  if (!args.list && !args.parks && !args.codes) {
    console.log(`用法：
  node scripts/scrape-kuaicha.mjs --list "松山湖"
  node scripts/scrape-kuaicha.mjs --parks "松山湖天安云谷,松山湖台湾高科技园"
  node scripts/scrape-kuaicha.mjs --codes "YQ0098348,YQ0023567"
  node scripts/scrape-kuaicha.mjs --from-json exports/快查企业名录-2026-11-13.json --park 松山湖北部 --building 天安云谷`);
    process.exit(1);
  }

  console.log("连接浏览器 …");
  await ensureBrowser();
  const { ws, send } = await connect();
  console.log("已连接。请确认该 Chrome 已登录快查（右上角显示你的会员账号）。\n");

  // 只搜园区
  if (args.list) {
    const parks = await searchParks(send, String(args.list));
    console.log(`关键词“${args.list}”命中 ${parks.length} 个园区：`);
    for (const p of parks) console.log(`  ${p.code}  ${p.name}  ${p.enter ?? "?"} 家`);
    ws.close();
    return;
  }

  // 解析目标园区
  const wanted = [];
  if (args.codes) {
    for (const code of String(args.codes).split(/[,，\s]+/).filter(Boolean)) {
      const detail = await parkDetail(send, code);
      wanted.push({ code, name: detail?.park_name || code });
      await sleep(DELAY);
    }
  }
  if (args.parks) {
    for (const name of String(args.parks).split(/[,，]+/).map((s) => s.trim()).filter(Boolean)) {
      const hits = await searchParks(send, name);
      const exact = hits.find((p) => p.name === name);
      if (!exact && hits.length !== 1) {
        console.log(`\n“${name}”不能唯一确定，候选如下，请用 --codes 指定：`);
        for (const p of hits) console.log(`  ${p.code}  ${p.name}  ${p.enter ?? "?"} 家`);
        ws.close();
        process.exit(2);
      }
      wanted.push(exact || hits[0]);
      await sleep(DELAY);
    }
  }

  console.log("开始抓取：");
  const all = [];
  for (const park of wanted) {
    console.log(`- ${park.name}（${park.code}）`);
    const rows = await listParkCompanies(send, park);
    for (const r of rows) all.push({ ...r, __park: args.park || park.name });
    console.log(`  完成，${rows.length} 家`);
  }
  ws.close();

  // 去重（同一企业可能在多个园区出现）
  const unique = dedupe(all);

  const out = args.out || path.join("exports", `快查企业名录-${new Date().toISOString().slice(0, 10)}.csv`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toCsv(unique, args.park ? String(args.park) : "", args.building ? String(args.building) : ""), "utf8");

  const rawOut = out.replace(/\.csv$/i, ".json");
  fs.writeFileSync(rawOut, JSON.stringify(unique, null, 1), "utf8");

  console.log(`\n抓取 ${all.length} 条，去重后 ${unique.length} 条`);
  console.log(`CSV：${out}`);
  console.log(`原始 JSON：${rawOut}`);
  console.log("\n下一步：打开网站后台 → 企业名录 → 导入，选择这个 CSV。");
}

main().catch((err) => {
  console.error("\n失败：" + (err?.message || err));
  process.exit(1);
});
