/* ============================================================
 * 松山湖写字楼招商小程序 · 数据层
 * 说明：使用 localStorage 模拟服务端，封装为 Api 对象，
 *      后续可平替为真实后端接口（小程序云开发 / REST API）。
 * ============================================================ */

/* ---------------- 基础工具 ---------------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const fmtDateTime = d => `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const today = () => fmtDate(new Date());
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const num = v => Number(String(v == null ? 0 : v).replace(/[^\d.-]/g, '')) || 0;
/* 经纬度保留 6 位小数（约 0.1 米精度）；0 视为未定位 */
const round6 = v => { const n = num(v); return n ? +n.toFixed(6) : 0; };
const money = n => Number(n || 0).toLocaleString('zh-CN');
const maskPhone = p => String(p || '').replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');

function toast(msg, ms) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms || 1800);
}

function dialog(opts) {
  const o = opts || {};
  const mask = $('#dialogMask'), box = $('#dialog');
  box.innerHTML = `
    <div class="dialog-title">${esc(o.title || '提示')}</div>
    ${o.text ? `<div class="dialog-text">${esc(o.text)}</div>` : ''}
    <div class="dialog-ops">
      ${o.cancelText === '' ? '' : `<button type="button" data-act="dlg:cancel">${esc(o.cancelText || '取消')}</button>`}
      <button type="button" class="${o.danger ? 'dan' : 'pri'}" data-act="dlg:ok">${esc(o.okText || '确定')}</button>
    </div>`;
  mask.classList.add('show');
  const close = () => mask.classList.remove('show');
  box.querySelector('[data-act="dlg:ok"]').onclick = () => { close(); o.onOk && o.onOk(); };
  const c = box.querySelector('[data-act="dlg:cancel"]');
  if (c) c.onclick = close;
}

let sheetReturnFocus = null;
function openSheet(html) {
  clearTimeout(closeSheet.timer);
  const mask = $('#sheetMask');
  if (!mask.classList.contains('show')) sheetReturnFocus = document.activeElement;
  mask.classList.remove('closing');
  const sheet = $('#sheet');
  sheet.innerHTML = html;
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', (sheet.querySelector('h3') || {}).textContent || '操作面板');
  sheet.querySelectorAll('.field').forEach(field=>{const label=field.querySelector('label'),input=field.querySelector('input,textarea,select');if(label&&input?.id)label.htmlFor=input.id;});
  sheet.querySelectorAll('.seg button').forEach(button=>button.setAttribute('aria-pressed',String(button.classList.contains('on'))));
  $('#sheetMask').classList.add('show');
  const focus = sheet.querySelector('input:not([type="hidden"]), textarea, button');
  if (focus) focus.focus({preventScroll:true});
}
function closeSheet() {
  const mask = $('#sheetMask');
  if ($('#sheet').querySelector('[data-pending="true"]')) { toast('正在提交，请稍候'); return; }
  if (!mask.classList.contains('show') || mask.classList.contains('closing')) return;
  State.filterDraft = null;
  const finish = () => {
    mask.classList.remove('show','closing');
    if (sheetReturnFocus && sheetReturnFocus.isConnected) sheetReturnFocus.focus({preventScroll:true});
  };
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) finish();
  else { mask.classList.add('closing'); closeSheet.timer = setTimeout(finish,180); }
}
document.addEventListener('keydown', event => {
  const mask = $('#sheetMask');
  if (!mask || !mask.classList.contains('show')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
  if (event.key !== 'Tab') return;
  const items = Array.from($('#sheet').querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')).filter(el => el.getClientRects().length);
  const first=items[0], last=items[items.length-1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last && last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first && first.focus(); }
});

/* ---------------- 房源示意图生成（SVG，4:3 = 800×600） ----------------
 * 管理端支持上传真实照片；未上传时使用内置示意图占位
 * ---------------------------------------------------------------------- */
const PALETTES = [
  { wall: '#F1EBE1', floor: '#D9C8B0', glass: '#DCEBF9', sky: '#BBD6F1', furn: '#8A6D4E', accent: '#C08A52' },
  { wall: '#E9EEF5', floor: '#C3CDD9', glass: '#D6E6F6', sky: '#A6C6E7', furn: '#5D7085', accent: '#7E93AB' },
  { wall: '#E6E9ED', floor: '#5A626C', glass: '#C7DBF1', sky: '#9DC1E3', furn: '#333B45', accent: '#48545F' },
  { wall: '#EDF3EC', floor: '#C8D7C3', glass: '#DAE9F4', sky: '#BCD9EE', furn: '#5E7E5A', accent: '#82A67C' }
];

function citySilhouette(y, h, color, opacity) {
  let s = '';
  const widths = [46, 62, 38, 74, 52, 88, 44, 66];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    const bh = h * (0.45 + ((i * 37) % 50) / 100);
    s += `<rect x="${x}" y="${y + h - bh}" width="${widths[i]}" height="${bh}" fill="${color}" opacity="${opacity}"/>`;
    x += widths[i] + 6;
  }
  return s;
}

function svgPhoto(type, pi) {
  const p = PALETTES[pi % PALETTES.length];
  const defs = `
    <defs>
      <linearGradient id="sky${pi}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${p.sky}"/><stop offset="1" stop-color="#EAF3FC"/>
      </linearGradient>
      <linearGradient id="sun${pi}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="rgba(255,255,255,.55)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/>
      </linearGradient>
      <linearGradient id="shade${pi}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(0,0,0,.14)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
      </linearGradient>
    </defs>`;

  const win = (x, y, w, h) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#sky${pi})"/>
    ${citySilhouette(x, y + h - 96, 96, p.furn, .28)}
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${p.furn}" stroke-width="5" opacity=".5"/>
    ${Array.from({ length: Math.max(0, Math.floor(w / 110)) }, (_, i) =>
    `<line x1="${x + (i + 1) * 110}" y1="${y}" x2="${x + (i + 1) * 110}" y2="${y + h}" stroke="${p.furn}" stroke-width="4" opacity=".4"/>`).join('')}
    <rect x="${x}" y="${y + h / 2}" width="${w}" height="4" fill="${p.furn}" opacity=".35"/>`;

  let body = '';
  if (type === 'facade') {
    body = `
      <rect width="800" height="600" fill="url(#sky${pi})"/>
      <circle cx="650" cy="110" r="90" fill="#FFFFFF" opacity=".5"/>
      ${citySilhouette(0, 470, p.furn, .22)}
      <rect x="120" y="70" width="560" height="420" rx="8" fill="${p.wall}" stroke="${p.accent}" stroke-width="4"/>
      ${Array.from({ length: 5 }, (_, r) => Array.from({ length: 7 }, (_, c) =>
      `<rect x="${146 + c * 76}" y="${98 + r * 78}" width="58" height="58" rx="3" fill="url(#sky${pi})" opacity=".92" stroke="${p.accent}" stroke-width="2.5"/>`).join('')).join('')}
      <rect x="120" y="70" width="560" height="420" rx="8" fill="url(#sun${pi})"/>
      <rect x="360" y="410" width="80" height="80" fill="${p.accent}" opacity=".75"/>
      <rect y="470" width="800" height="130" fill="${p.floor}"/>
      <rect y="470" width="800" height="14" fill="#FFFFFF" opacity=".35"/>
      ${[70, 690].map(x => `<g><rect x="${x}" y="410" width="10" height="76" fill="${p.furn}" opacity=".6"/>
        <circle cx="${x + 5}" cy="392" r="30" fill="${p.accent}" opacity=".85"/>
        <circle cx="${x - 16}" cy="404" r="22" fill="${p.accent}" opacity=".7"/>
        <circle cx="${x + 26}" cy="404" r="22" fill="${p.accent}" opacity=".7"/></g>`).join('')}`;
  } else if (type === 'open') {
    body = `
      <rect width="800" height="600" fill="${p.floor}"/>
      <rect y="0" width="800" height="380" fill="${p.wall}"/>
      <rect x="60" y="380" width="680" height="10" fill="${p.accent}" opacity=".25"/>
      ${win(70, 70, 660, 240)}
      <rect x="200" y="26" width="400" height="14" rx="7" fill="#FFFFFF" opacity=".85"/>
      ${[0, 1].map(r => `
        <g>
          <rect x="90" y="${430 + r * 100}" width="620" height="16" rx="4" fill="${p.furn}" opacity=".9"/>
          <rect x="110" y="${446 + r * 100}" width="12" height="60" fill="${p.furn}" opacity=".55"/>
          <rect x="678" y="${446 + r * 100}" width="12" height="60" fill="${p.furn}" opacity=".55"/>
          ${[0, 1, 2].map(c => `
            <g>
              <rect x="${170 + c * 200}" y="${392 + r * 100}" width="86" height="52" rx="4" fill="${p.accent}" opacity=".85"/>
              <rect x="${188 + c * 200}" y="${402 + r * 100}" width="50" height="32" rx="2" fill="#FFFFFF" opacity=".55"/>
              <rect x="${208 + c * 200}" y="${436 + r * 100}" width="10" height="14" fill="${p.furn}"/>
              <circle cx="${213 + c * 200}" cy="${488 + r * 100}" r="24" fill="${p.furn}" opacity=".7"/>
            </g>`).join('')}
        </g>`).join('')}
      <g>
        <rect x="700" y="470" width="44" height="60" rx="5" fill="${p.accent}" opacity=".5"/>
        <circle cx="722" cy="452" r="30" fill="${p.accent}" opacity=".8"/>
        <circle cx="700" cy="466" r="22" fill="${p.accent}" opacity=".65"/>
        <circle cx="744" cy="466" r="22" fill="${p.accent}" opacity=".65"/>
      </g>
      <rect width="800" height="600" fill="url(#shade${pi})"/>`;
  } else if (type === 'office') {
    body = `
      <rect width="800" height="600" fill="${p.floor}"/>
      <rect y="0" width="800" height="390" fill="${p.wall}"/>
      ${win(430, 80, 310, 230)}
      <rect x="80" y="120" width="240" height="250" rx="6" fill="${p.accent}" opacity=".22"/>
      ${[0, 1, 2, 3].map(i => `<rect x="92" y="${140 + i * 58}" width="216" height="16" rx="3" fill="${p.furn}" opacity=".5"/>`).join('')}
      <rect x="240" y="400" width="330" height="18" rx="5" fill="${p.furn}"/>
      <rect x="262" y="418" width="14" height="86" fill="${p.furn}" opacity=".6"/>
      <rect x="534" y="418" width="14" height="86" fill="${p.furn}" opacity=".6"/>
      <rect x="330" y="340" width="120" height="66" rx="4" fill="${p.accent}" opacity=".9"/>
      <rect x="352" y="352" width="76" height="42" rx="2" fill="#FFFFFF" opacity=".5"/>
      <rect x="384" y="406" width="14" height="16" fill="${p.furn}"/>
      <circle cx="300" cy="520" r="30" fill="${p.furn}" opacity=".72"/>
      <circle cx="520" cy="520" r="30" fill="${p.furn}" opacity=".72"/>
      <g>
        <rect x="646" y="450" width="50" height="66" rx="5" fill="${p.accent}" opacity=".5"/>
        <circle cx="671" cy="430" r="34" fill="${p.accent}" opacity=".85"/>
        <circle cx="645" cy="448" r="24" fill="${p.accent}" opacity=".65"/>
        <circle cx="697" cy="448" r="24" fill="${p.accent}" opacity=".65"/>
      </g>
      <rect width="800" height="600" fill="url(#shade${pi})"/>`;
  } else if (type === 'meeting') {
    body = `
      <rect width="800" height="600" fill="${p.floor}"/>
      <rect y="0" width="800" height="370" fill="${p.wall}"/>
      ${win(60, 70, 260, 200)}
      <rect x="430" y="96" width="300" height="170" rx="6" fill="#2C3440" opacity=".85"/>
      <rect x="444" y="110" width="272" height="142" rx="3" fill="${p.glass}" opacity=".7"/>
      <rect x="150" y="380" width="500" height="40" rx="20" fill="${p.accent}" opacity=".9"/>
      ${[0, 1, 2].map(i => `<rect x="${190 + i * 30}" y="440" width="18" height="90" fill="${p.furn}" opacity=".45"/>`).join('')}
      ${[0, 1, 2].map(i => `<rect x="${566 - i * 30}" y="440" width="18" height="90" fill="${p.furn}" opacity=".45"/>`).join('')}
      ${[0, 1, 2, 3, 4].map(i => `
        <g>
          <circle cx="${190 + i * 88}" cy="330" r="30" fill="${p.furn}" opacity=".78"/>
          <rect x="${168 + i * 88}" y="358" width="44" height="30" rx="8" fill="${p.furn}" opacity=".6"/>
        </g>`).join('')}
      <rect x="330" y="30" width="140" height="10" rx="5" fill="#FFFFFF" opacity=".8"/>
      <rect width="800" height="600" fill="url(#shade${pi})"/>`;
  } else if (type === 'lobby') {
    body = `
      <rect width="800" height="600" fill="${p.floor}"/>
      <rect y="0" width="800" height="420" fill="${p.wall}"/>
      <rect x="60" y="60" width="680" height="300" rx="8" fill="${p.accent}" opacity=".14"/>
      <text x="400" y="200" font-size="64" font-weight="700" text-anchor="middle"
        fill="${p.accent}" opacity=".55" font-family="PingFang SC,Microsoft YaHei,sans-serif">松山湖</text>
      <text x="400" y="262" font-size="26" letter-spacing="8" text-anchor="middle"
        fill="${p.accent}" opacity=".45" font-family="PingFang SC,Microsoft YaHei,sans-serif">写字楼招商</text>
      <rect x="120" y="400" width="400" height="90" rx="8" fill="${p.furn}" opacity=".85"/>
      <rect x="120" y="400" width="400" height="16" rx="4" fill="#FFFFFF" opacity=".25"/>
      ${[0, 1, 2].map(i => `<rect x="${340 + i * 70}" y="30" width="34" height="34" rx="17" fill="#FFFFFF" opacity=".8"/>
        <line x1="${357 + i * 70}" y1="0" x2="${357 + i * 70}" y2="30" stroke="${p.furn}" stroke-width="3" opacity=".5"/>`).join('')}
      <g>
        <rect x="640" y="440" width="56" height="76" rx="6" fill="${p.accent}" opacity=".45"/>
        <circle cx="668" cy="416" r="38" fill="${p.accent}" opacity=".8"/>
        <circle cx="636" cy="438" r="26" fill="${p.accent}" opacity=".6"/>
        <circle cx="700" cy="438" r="26" fill="${p.accent}" opacity=".6"/>
      </g>
      <rect width="800" height="600" fill="url(#shade${pi})"/>`;
  } else {
    body = `
      <rect width="800" height="600" fill="${p.wall}"/>
      <polygon points="240,190 560,190 560,430 240,430" fill="${p.floor}" opacity=".55"/>
      <polygon points="0,0 240,190 240,430 0,600" fill="${p.floor}" opacity=".35"/>
      <polygon points="800,0 560,190 560,430 800,600" fill="${p.floor}" opacity=".25"/>
      <polygon points="240,190 560,190 560,430 240,430" fill="none" stroke="${p.accent}" stroke-width="7"/>
      <rect x="300" y="210" width="200" height="200" fill="url(#sky${pi})" opacity=".9"/>
      ${[0, 1, 2].map(i => `
        <g>
          <rect x="${70 - i * 24}" y="${120 + i * 92}" width="${120 - i * 22}" height="${120 - i * 20}" rx="4"
            fill="${p.accent}" opacity="${.34 - i * .07}" stroke="${p.furn}" stroke-width="3"/>
          <rect x="${660 + i * 24}" y="${120 + i * 92}" width="${120 - i * 22}" height="${120 - i * 20}" rx="4"
            fill="${p.accent}" opacity="${.34 - i * .07}" stroke="${p.furn}" stroke-width="3"/>
        </g>`).join('')}
      ${[0, 1, 2, 3].map(i => `<rect x="${300 + i * 10}" y="${30 + i * 9}" width="${200 - i * 20}" height="10" rx="5" fill="#FFFFFF" opacity=".85"/>`).join('')}
      <rect width="800" height="600" fill="url(#shade${pi})"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">${defs}${body}</svg>`;
}

function photoURI(type, pi) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgPhoto(type, pi || 0));
}
const PHOTO_SETS = [
  ['facade', 'open', 'meeting'],
  ['open', 'office', 'corridor'],
  ['facade', 'meeting', 'lobby'],
  ['office', 'open', 'corridor'],
  ['facade', 'lobby', 'meeting']
];

/* ---------------- 演示图占位标记 ----------------
 * 演示用 SVG 图每张约 8KB，3 张一套近 25KB。直接存进 localStorage 会白白吃掉
 * 手机空间（几十套房就是几百 KB）。这里改为只存一个极短的标记 demo:<type>:<palette>，
 * 渲染时再即时生成真正的 SVG —— 显示效果完全一致，本机体积降到几乎为零。
 * 注意：真实上传的照片一律是 base64 或 /api/photo/ 地址，不受此机制影响。 */
const DEMO_PREFIX = 'demo:';
function demoPhoto(type, pi) { return DEMO_PREFIX + type + ':' + ((pi || 0) % PALETTES.length); }
function isDemoPhoto(p) { return typeof p === 'string' && p.indexOf(DEMO_PREFIX) === 0; }
/* 把 demo: 标记展开成真正的图片地址；非标记原样返回 */
function expandPhoto(p) {
  if (!isDemoPhoto(p)) return p;
  const parts = p.slice(DEMO_PREFIX.length).split(':');
  return photoURI(parts[0] || 'facade', Number(parts[1]) || 0);
}

/* ---------------- 底图标定信息 ----------------
 * 用「水域形状匹配」把 assets/songshanhu-map.jpg 与真实地图做几何配准，
 * 得到底图覆盖的经纬度范围（WGS84/GCJ-02 平面，GCJ-02 偏移已在配准时吸收）。
 * 底图 1280×1280，每像素约 12.3 米。
 * ------------------------------------------------ */
const MAP_BBOX = {
  lonLeft: 113.81811, lonRight: 113.95947,
  latBottom: 22.85495, latTop: 22.98540,
  px: 1280
};

const _mercY = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
/* 经纬度 → 底图百分比坐标（与底图墨卡托投影一致） */
function projectToMap(lat, lon) {
  const x = (lon - MAP_BBOX.lonLeft) / (MAP_BBOX.lonRight - MAP_BBOX.lonLeft) * 100;
  const y = (_mercY(MAP_BBOX.latTop) - _mercY(lat)) /
    (_mercY(MAP_BBOX.latTop) - _mercY(MAP_BBOX.latBottom)) * 100;
  return { x: +x.toFixed(2), y: +y.toFixed(2) };
}
/* 底图百分比坐标 → 经纬度（供地图标注反查） */
function unprojectFromMap(x, y) {
  const lon = MAP_BBOX.lonLeft + (x / 100) * (MAP_BBOX.lonRight - MAP_BBOX.lonLeft);
  const mTop = _mercY(MAP_BBOX.latTop), mBot = _mercY(MAP_BBOX.latBottom);
  const m = mTop - (y / 100) * (mTop - mBot);
  const lat = (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * 180 / Math.PI;
  return { lat: +lat.toFixed(6), lon: +lon.toFixed(6) };
}

/* ---------------- 常量选项 ---------------- */
/* Public regions only; private park directories are never downloaded here. */
const PUBLIC_REGIONS = ['北部','中部','南部','生态园','大朗','寮步','大岭山','东城','南城'];
const PARKS = PUBLIC_REGIONS.map(name=>({name,x:50,y:50,lat:0,lon:0,precise:false,addr:''}));
const OPT_ORIENT = ['东南', '南', '西南', '东', '东北', '北', '西北', '西', '南北通透'];
const OPT_DECO = ['豪装', '精装修', '带家具', '带家具精装', '简装', '毛坯'];
const OPT_LAYOUT = ['大开间', '2+1', '3+1', '4+1', '5+2', '6+2', '整层'];
const CONTACTS = [{ name: '招商顾问', phone: '', role: '招商顾问' }];
const SORT_OPTS = [
  { k: 'default', t: '综合排序' },
  { k: 'rent-asc', t: '租金从低到高' },
  { k: 'rent-desc', t: '租金从高到低' },
  { k: 'area-desc', t: '面积从大到小' },
  { k: 'views', t: '浏览量最多' },
  { k: 'new', t: '最新上架' }
];
const AREA_OPTS = ['全部', '0-100', '100-200', '200-300', '300-500', '500-1000', '1000-3000', '3000-5000', '5000-'];
const RENT_OPTS = ['全部', '0-20', '20-30', '30-40', '40-60', '60-'];
const MSG_TYPES = ['预约看房', '租金咨询', '补贴政策', '其他问题'];

/* ---------------- 种子数据 ---------------- */
const DB_KEY = 'songshanhu_web_experience_v1';
/* 数据备份（版本更新/迁移/重置前自动快照，永不自动删除数据）
   注意：备份是**整库快照**，如果库里含 base64 照片，5 份备份就是 5 倍膨胀，
   这正是过去"手机本地存储不足"的主因之一。所以：
   ① 备份里主动剥离照片（照片已在服务器独立存储，且云端有副本，本地备份不需要带图）
   ② 备份份数收敛到 3 份，且只保留最近一次手动备份 */
const BACKUP_KEY = 'sshl_office_backup_v1';
const BACKUP_MAX = 3, BACKUP_MIN_GAP = 3 * 60 * 1000;

/* 快照瘦身：把 photos 换成极短占位，避免整库备份被照片撑爆。
   恢复备份时照片会从服务器/云端重新取回，不依赖本地备份里的图。 */
function slimSnapshot(raw) {
  try {
    const d = JSON.parse(raw);
    if (!d) return raw;
    (d.listings || []).forEach(l => {
      if (Array.isArray(l.photos) && l.photos.length) {
        /* 保留照片数量信息（便于恢复时按需补图），但不保留图片本体 */
        l.photoCount = l.photos.length;
        l.photos = l.photos.map(p => (typeof p === 'string' && p.indexOf('demo:') === 0) ? p : '');
        l.photosStripped = true;
      }
    });
    return JSON.stringify(d);
  } catch (e) { return raw; }
}

function backupSnapshot(reason) {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return;
    /* 整库快照前先瘦身，杜绝备份放大内容占用 */
    const slim = slimSnapshot(raw);
    let list = [];
    try { list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch (e) { list = []; }
    const now = Date.now();
    if (list.length && reason === 'auto' && now - list[0].ts < BACKUP_MIN_GAP) return;
    let d = null; try { d = JSON.parse(raw); } catch (e) { }
    list.unshift({
      ts: now, reason: reason || 'auto',
      counts: d ? `房源${(d.listings || []).length}·园区${(d.parks || []).length}·管理员${(d.admins || []).length}·留言${(d.messages || []).length}` : '?',
      data: slim
    });
    list = list.slice(0, BACKUP_MAX);
    try {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(list));
    } catch (e) {
      /* 还写不下：退化成只留最新 1 份，绝不让备份把主库挤掉 */
      try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, 1))); } catch (e2) {
        try { localStorage.removeItem(BACKUP_KEY); } catch (e3) { }
      }
    }
  } catch (e) { console.warn('备份失败', e); }
}
const SES_KEY = 'songshanhu_web_session_v1';

function seedDB() {
  const rows = [];
  const descs = [
    '房源位于松山湖高新区核心板块，双面采光，层高 4.2 米，可整层或分层出租。园区配套成熟，配有人才公寓、员工食堂与共享会议室，步行 8 分钟可达城轨站，周边华为、生益科技等龙头企业环绕，人才招聘便利。',
    '全新交付写字楼，独立大堂与电梯厅，VRV 中央空调与新风系统到户，公区精装交付，可拎包入驻。园区提供工商注册、政策申报、财税代理等一站式服务，适合科技型企业与研发团队。',
    '大开间无柱设计，得房率高，适合研发办公与轻型中试组合使用。园区内配套共享实验室与检测平台，物业管理规范，停车位充足，可按需分割出租。',
    '临湖办公环境优越，窗外即松山湖风景区视野，独立空调计费，24 小时安保与门禁。园区聚集医疗器械、新材料、智能制造等产业集群，上下游协作便利。'
  ];
  const now = new Date();
  const listings = rows.map((n, i) => {
    const set = PHOTO_SETS[i % PHOTO_SETS.length];
    const c = CONTACTS[i % CONTACTS.length];
    const park = PARKS.find(p => p.name === n[0]) || PARKS[0];
    return {
      id: 'L' + String(1001 + i),
      parkName: n[0], building: n[1], floor: n[2], area: n[3], orientation: n[4],
      decoration: n[5], layout: n[6], rent: n[7], propertyFee: n[8],
      /* 演示图只存短标记（渲染时展开），避免把几十 KB 的 SVG 塞进本机缓存 */
      photos: set.map((t, k) => demoPhoto(t, n[9] + k)),
      photosLoaded: true,
      demoPhotos: true,     /* 标记：这套是演示图，不参与照片迁移/云端大图 */
      tag: i === 0 ? '热门' : (i === 2 ? '特价' : (i === 4 ? '新上' : '')),
      status: i === 12 ? 'offline' : 'online',
      contact: c.name, phone: c.phone, address: park.addr,
      coord: { x: park.x, y: park.y },
      desc: descs[i % descs.length],
      usage: (n[0] === '松山湖机器人产业基地' || n[0] === '松湖智谷') ? '厂房' : '写字楼',
      views: 40 + ((i * 53) % 260),
      createdAt: new Date(now.getTime() - (i + 1) * 172800000).toISOString(),
      updatedAt: new Date(now.getTime() - (i + 1) * 86400000).toISOString()
    };
  });

  const visitLog = [];
  const base = [18, 24, 21, 33, 29, 41, 37];
  for (let i = 6; i >= 0; i--) visitLog.push({ d: fmtDate(dayOffset(-i)), v: base[6 - i] });

  return {
    listings,
    parks: [],
    visitors: [],
    messages: [],
    admins: [],
    settings: {
      maxAdmins: 5, siteName: '松山湖产业招商', hotline: '',
      // 短信验证码配置（演示模式下不真正发短信，验证码直接提示在页面上）
      sms: { provider: 'demo', sign: '松山湖写字楼', demoShow: true, ttlSec: 300, cooldownSec: 60, maxTry: 5 },
      // 微信分享 / 公众号 JS-SDK 配置占位：填入公众号 appId 后即可启用原生分享
      wx: { appId: '', jsApiList: ['updateAppMessageShareData', 'updateTimelineShareData'] },
      // 地图标注（园区名 → 底图百分比坐标）。为空时使用内置坐标
      parkCoords: {},
      // 腾讯位置服务 Key（合规在线地图必需；留空则回退到内置静态底图）
      tmapKey: '',
      // 转发卡片自定义（标题 / 描述 / 封面图 data URL 或路径，空则用默认）
      share: { title: '松山湖产业招商网站', desc: '地图找房、筛选比价、在线留言，招商顾问一对一对接', img: '' },
      // 产业资源（管理员后台录入，产业资源页展示）
      indRes: []
    },
    stats: { visitors: 0, views: 0, todayVisitors: 0, todayViews: 0 },
    visitLog,
    version: 2
  };
}

/* ---------------- Api（模拟后端） ---------------- */
const Api = {
  db: null,
  load() {
    let raw = null;
    try { raw = localStorage.getItem(DB_KEY); } catch (e) { }
    /* 迁移/升级前先自动快照，保证任何版本更新都不会丢数据 */
    backupSnapshot('auto');
    try {
      if (raw) this.db = JSON.parse(raw);
    } catch (e) {
      console.warn('本地数据读取失败（备份中可能有可用快照），已暂用演示数据', e);
    }
    if (!this.db || !this.db.listings) { this.db = seedDB(); this.save(); }
    /* 空间自愈：老版本把 base64 照片存在本机，是"本地存储不足"的根因。
       这里在每次加载时主动把本机 base64 照片清掉（照片本体已在服务器独立存储，
       云端也有副本，页面上照常显示），把空间立刻腾出来，无需等管理员操作。 */
    this.slimLocalPhotos();
    if (!this.db.visitLog) this.db.visitLog = [];
    if (!this.db.viewedMap) this.db.viewedMap = {};
    if (!this.db.viewMap || typeof this.db.viewMap !== 'object') this.db.viewMap = {};
    /* 删除墓碑：记录本端删除过的行，防止别的设备用旧缓存把已删除数据推回云端复活 */
    if (!Array.isArray(this.db.tomb)) this.db.tomb = [];
    /* 待同步队列：改过但没推上云端的行，同步时用本地版本盖回并重推 */
    if (!this.db.dirty || typeof this.db.dirty !== 'object') this.db.dirty = {};
    /* 老数据迁移：补齐新增的设置项 */
    if (!this.db.settings) this.db.settings = {};
    const st = this.db.settings, sd = seedDB().settings;
    if (!st.sms) st.sms = sd.sms;
    if (!st.wx) st.wx = sd.wx;
    if (!st.wx.appSecret) st.wx.appSecret = '';
    if (!st.parkCoords) st.parkCoords = {};
    /* 在线地图 Key（腾讯位置服务）：老数据补空值，不覆盖已配置的 */
    if (typeof st.tmapKey !== 'string') st.tmapKey = '';
    if (!st.share) st.share = sd.share;
    if (!st.share.title) st.share.title = sd.share.title;
    if (!st.share.desc) st.share.desc = sd.share.desc;
    /* 品牌名升级：松山湖写字楼招商 → 松山湖产业招商 */
    if (st.siteName === '松山湖写字楼招商') st.siteName = '松山湖产业招商';
    /* 手机端分享卡片/海报：云端旧默认分享标题同步替换为新品牌（管理员自定义过的不动） */
    if (st.share && st.share.title === '松山湖写字楼招商 · 12 个产业园在租房源') st.share.title = '松山湖产业招商小程序';
    if (st.share && st.share.title === '松山湖产业招商 · 12 个产业园在租房源') st.share.title = '松山湖产业招商小程序';
    /* 产业资源（管理员录入） */
    if (!st.indRes) st.indRes = JSON.parse(JSON.stringify(sd.indRes));
    /* 老房源补业态字段（写字楼 / 厂房），保证三入口筛选可用；同时补齐精准定位字段 */
    (this.db.listings || []).forEach(l => {
      if (!l.usage) l.usage = '写字楼';
      if (typeof l.lat !== 'number') l.lat = 0;
      if (typeof l.lng !== 'number') l.lng = 0;
    });
    /* 老数据迁移：园区列表数据化（可后台编辑） */
    if (!Array.isArray(this.db.parks)) this.db.parks = [];
    return this.db;
  },
  save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.db)); }
    catch (e) {
      /* 写不下时先自救：清空备份队列 + 剥离本机 base64 照片，再试一次 */
      console.warn('本地存储写入失败，尝试释放空间后重试', e);
      try { localStorage.removeItem(BACKUP_KEY); } catch (e2) { }
      try { this.slimLocalPhotos(true); localStorage.setItem(DB_KEY, JSON.stringify(this.db)); toast('已自动释放本机照片缓存，空间已腾出'); }
      catch (e3) { toast('本地存储空间不足，请减少上传图片后重试'); }
    }
  },

  /* 把本机房源里的 base64 照片换成"待从服务器取回"的引用。
     页面渲染时 photoURL() 会用 /api/photo/<id>/<i> 从服务器取图，显示效果不变；
     服务器没这张图时，server.js 会自动回退读云端 listings 里的 base64（legacyPhoto）。
     返回清理掉的照片张数。

     安全前提：只有在**云端确实存有这组照片**时才会剥离本机副本，
     否则宁可占用空间也不删（避免任何一张照片只剩本机一份却被清掉）。 */
  slimLocalPhotos(silent) {
    const needCloud = (this.db.listings || []).some(l =>
      (l.photos || []).some(p => typeof p === 'string' && /^data:image\//.test(p)));
    if (!needCloud) return 0;
    /* 云端已确认可用且已同步过，才做剥离；否则交给管理员登录后的迁移流程 */
    if (!(Cloud && Cloud.ready && this.db.meta && this.db.meta.photoBackedUp)) return 0;
    let n = 0;
    (this.db.listings || []).forEach(l => {
      const ps = l.photos || [];
      if (!ps.some(p => typeof p === 'string' && /^data:image\//.test(p))) return;
      l.photos = ps.map((p, i) => {
        if (typeof p === 'string' && /^data:image\//.test(p)) {
          n++;
          return '/api/photo/' + l.id + '/' + i;
        }
        return p;
      });
      l.photosLoaded = false;
    });
    if (n) {
      try { localStorage.setItem(DB_KEY, JSON.stringify(this.db)); } catch (e) { }
      if (!silent) console.log('[存储自愈] 已把 ' + n + ' 张本机 base64 照片转为服务器引用');
    }
    return n;
  },
  reset() { backupSnapshot('reset'); this.db = seedDB(); this.save(); },

  /* 手动备份 / 备份列表 / 恢复备份（恢复后自动同步云端） */
  backupNow() { backupSnapshot('manual'); return this.backups(); },
  backups() {
    try { return JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]'); } catch (e) { return []; }
  },
  restoreBackup(i) {
    const list = this.backups();
    const b = list[i];
    if (!b) return { ok: false, msg: '备份不存在' };
    try {
      const d = JSON.parse(b.data);
      if (!d || !d.listings) return { ok: false, msg: '备份数据不完整' };
      backupSnapshot('before-restore');
      this.db = d; this.save();
      /* 恢复后把快照内容回推云端（后台执行，非空才推，绝不删云端多余行） */
      if (typeof Cloud !== 'undefined' && Cloud.ready) {
        ['listings', 'parks', 'messages', 'visitors'].forEach(t => {
          const rows = d[t] || [];
          if (rows.length) {
            /* 恢复是明确动作：清掉这批数据的墓碑，并整体回写（含照片大图） */
            Cloud.clearTombFor(t, rows.map(r => (r.id != null ? r.id : r.name)));
            Cloud.pushMany(t, rows, { forceFull: true });
          }
        });
        Cloud.pushMeta();
      }
      return { ok: true };
    } catch (e) { return { ok: false, msg: '备份解析失败' }; }
  },

  logVisit() {
    const d = today();
    const log = this.db.visitLog;
    const rec = log.find(x => x.d === d);
    if (rec) rec.v++; else log.push({ d, v: 1 });
    if (log.length > 30) log.splice(0, log.length - 30);
    this.db.stats.visitors++;
    this.db.stats.todayVisitors = rec ? rec.v : 1;
    if (this.db.stats.todayViews == null) this.db.stats.todayViews = 0;
    this.save();
    Cloud.pushMetaSoon();
  },
  /* 浏览量：只累加本机计数并写 meta 汇总，绝不回推整行房源。
     回推整行会让访客手机上的旧副本覆盖云端（照片/信息被改回旧值），这是历史故障根源 */
  logView(listingId) {
    window.SiteTelemetry?.view(listingId);
    const l = this.db.listings.find(x => x.id === listingId);
    if (l) l.views = (l.views || 0) + 1;
    if (!this.db.viewMap || typeof this.db.viewMap !== 'object') this.db.viewMap = {};
    this.db.viewMap[listingId] = (this.db.viewMap[listingId] || 0) + 1;
    this.db.stats.views++;
    this.db.stats.todayViews = (this.db.stats.todayViews || 0) + 1;
    this.save();
    Cloud.pushMetaSoon();
  },
  getSession() {
    try { return JSON.parse(localStorage.getItem(SES_KEY) || '{}'); } catch (e) { return {}; }
  },
  setSession(s) { localStorage.setItem(SES_KEY, JSON.stringify(s)); },

  /* 记住上次登录的手机号 / 管理员账号 */
  getPhone() { try { return localStorage.getItem(PHONE_KEY) || ''; } catch (e) { return ''; } },
  setPhone(p) { try { localStorage.setItem(PHONE_KEY, String(p || '')); } catch (e) { } },

  /* 生效的园区坐标：后台标注优先，其次内置默认 */
  parkCoord(name) {
    const p = PARKS.find(x => x.name === name);
    const o = (this.db && this.db.settings && this.db.settings.parkCoords) || {};
    if (o[name] && typeof o[name].x === 'number') return { x: o[name].x, y: o[name].y, custom: true };
    return p ? { x: p.x, y: p.y, custom: false } : { x: 50, y: 50, custom: false };
  },
  setParkCoord(name, x, y) {
    if (!this.db.settings.parkCoords) this.db.settings.parkCoords = {};
    this.db.settings.parkCoords[name] = { x: +(+x).toFixed(2), y: +(+y).toFixed(2), at: fmtDateTime(new Date()) };
    this.save();
  },
  resetParkCoord(name) {
    if (this.db.settings.parkCoords) delete this.db.settings.parkCoords[name];
    this.save();
  },

  /* ---------------- 园区管理（后台可增删改） ---------------- */
  parks() { return (this.db && this.db.parks) || []; },
  park(name) { return this.parks().find(p => p.name === name); },

  /* 新增园区：有经纬度则自动投影到底图百分比坐标 */
  addPark(o) {
    const name = String(o.name || '').trim();
    if (!name) return { ok: false, msg: '请填写园区名称' };
    if (this.park(name)) return { ok: false, msg: '该园区已存在' };
    const p = { name, addr: String(o.addr || '').trim(), lat: num(o.lat) || 0, lon: num(o.lon) || 0, precise: !!(o.lat && o.lon), __local: true };
    if (p.lat && p.lon) { const c = projectToMap(p.lat, p.lon); p.x = c.x; p.y = c.y; }
    else { p.x = num(o.x) || 50; p.y = num(o.y) || 50; }
    this.db.parks.push(p);
    this.save();
    Cloud.pushRow('parks', p);
    Cloud.pushMetaSoon();
    return { ok: true };
  },

  /* 编辑园区：改名时同步房源与手动标注 */
  updatePark(oldName, o) {
    const p = this.park(oldName);
    if (!p) return { ok: false, msg: '园区不存在' };
    const name = String(o.name || '').trim();
    if (!name) return { ok: false, msg: '请填写园区名称' };
    if (name !== oldName && this.park(name)) return { ok: false, msg: '新名称与其他园区重复' };
    p.name = name;
    p.addr = String(o.addr || '').trim();
    const lat = num(o.lat), lon = num(o.lon);
    if (lat && lon) { p.lat = lat; p.lon = lon; p.precise = true; const c = projectToMap(lat, lon); p.x = c.x; p.y = c.y; }
    /* 同步房源 */
    if (name !== oldName) {
      this.db.listings.forEach(l => {
        if (l.parkName === oldName) {
          l.parkName = name;
          if (l.coord) { l.coord.x = p.x; l.coord.y = p.y; }
          Cloud.pushRow('listings', l);
        }
      });
      const pc = this.db.settings.parkCoords || {};
      if (pc[oldName]) { pc[name] = pc[oldName]; delete pc[oldName]; }
    }
    this.save();
    Cloud.pushRow('parks', p);
    /* 改名后：删掉云端旧名的行（否则同步时旧园区会被拉回来重复显示） */
    if (name !== oldName) {
      Cloud.clearTombFor('parks', [name]);
      Cloud.markDeleted('parks', oldName);
    }
    Cloud.pushMetaSoon();
    return { ok: true };
  },

  /* 删除园区：有房源时拒绝 */
  deletePark(name) {
    const cnt = this.db.listings.filter(l => l.parkName === name).length;
    if (cnt > 0) return { ok: false, msg: `该园区下还有 ${cnt} 套房源，请先移除或改到其他园区` };
    const i = this.db.parks.findIndex(p => p.name === name);
    if (i < 0) return { ok: false, msg: '园区不存在' };
    this.db.parks.splice(i, 1);
    if (this.db.settings.parkCoords) delete this.db.settings.parkCoords[name];
    this.save();
    Cloud.markDeleted('parks', name);
    Cloud.pushMetaSoon();
    return { ok: true };
  }
};

/* ---------------- 短信验证码服务 ----------------
 * 演示模式（provider: 'demo'）下不真正发短信，验证码会在页面上提示；
 * 接入真实短信平台时，把 send() 换成后端接口调用即可（后端生成并下发短信），
 * 同时把 verify() 改为后端校验。verifyCodes 仅存在于内存，刷新即失效。
 * -------------------------------------------------- */
const PHONE_KEY = 'sshl_office_last_phone_v1';
const verifyCodes = {};

const Sms = {
  conf() {
    const s = (Api.db && Api.db.settings && Api.db.settings.sms) || {};
    return Object.assign({ provider: 'demo', sign: '松山湖写字楼', demoShow: true, ttlSec: 300, cooldownSec: 60, maxTry: 5 }, s);
  },
  gen6() { return String(Math.floor(100000 + Math.random() * 900000)); },
  /* 返回 { ok, code, msg, wait } */
  send(phone) {
    const c = this.conf();
    if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, msg: '请输入正确的手机号' };
    const last = verifyCodes[phone];
    if (last && Date.now() - last.sentAt < c.cooldownSec * 1000) {
      return { ok: false, msg: '发送过于频繁，请稍后再试', wait: Math.ceil((c.cooldownSec * 1000 - (Date.now() - last.sentAt)) / 1000) };
    }
    const code = this.gen6();
    verifyCodes[phone] = { code, sentAt: Date.now(), expireAt: Date.now() + c.ttlSec * 1000, tryCount: 0 };
    if (c.provider === 'demo') return { ok: true, code, msg: '验证码已发送' };
    /* 真实通道：此处替换为 fetch('/api/sms/send', {...}) */
    return { ok: true, code: '', msg: '验证码已发送' };
  },
  /* 返回 { ok, msg, remain } */
  verify(phone, input) {
    const c = this.conf();
    const rec = verifyCodes[phone];
    if (!rec) return { ok: false, msg: '请先获取验证码' };
    if (Date.now() > rec.expireAt) { delete verifyCodes[phone]; return { ok: false, msg: '验证码已过期，请重新获取' }; }
    if (rec.tryCount >= c.maxTry) { delete verifyCodes[phone]; return { ok: false, msg: '错误次数过多，请重新获取验证码' }; }
    rec.tryCount++;
    if (String(input).trim() !== rec.code) {
      return { ok: false, msg: `验证码不正确，还可尝试 ${Math.max(0, c.maxTry - rec.tryCount)} 次` };
    }
    delete verifyCodes[phone];
    return { ok: true, msg: '验证通过' };
  },
  clear(phone) { delete verifyCodes[phone]; }
};

/* ---------------- 云端同步 ----------------
 * 架构：本地 localStorage 作缓存与离线兜底，云端为准。
 *  - 启动时拉取云端 5 张表（listings / parks / messages / visitors / meta）；
 *  - 所有写操作在改完本地后逐行 upsert / delete 到云端；
 *  - 云端房源空时把本端数据作为初始数据上云（谁先上线谁定基调）；
 *  - 照片大图放 listings.full 列，列表拉取不带（保证首次加载快），详情页单条补拉。
 *  - SDK 未加载（离线 / 弱网）时 Cloud.ready=false，自动退化为纯本地模式，不影响使用。
 * 说明：本阶段为演示级权限（公开读写），正式运营需加服务端鉴权。
 * -------------------------------------------------- */
const Cloud = {
  // 房源由 bridge.js 从本网站的 Supabase 公开视图读取。绝不连接 WorkBuddy 云服务。
  ready: false,
  client: null,
  init() {},
  async pull() { return { ok: true, inited: true }; },
  async seedIfEmpty() { return false; },
  async pushRow() { return false; },
  async pushMany() { return false; },
  async pushDelete() { return false; },
  async pushMeta() { return false; },
  pushMetaSoon() {},
  markDirty() {},
  markDirtyKeys() {},
  clearTombFor() {},
  markDeleted() {},
  async reconcile() { return false; },
  async pushAdmins() { return false; }
};

/* ---------------- 全局状态 ---------------- */
const State = {
  listingsLoading: true,
  listingsError: false,
  listingsErrorMessage: "",
  listingsErrorCode: "",
  tab: 'home',
  view: 'home',
  stack: [],
  params: {},
  filters: { kw: '', park: '全部', usage: '全部', rent: '全部', area: '全部', orientation: '全部', decoration: '全部', layout: '全部', sort: 'default' },
  adminTab: 'listing',
  adminListFilter: 'all',
  adminKw: '',
  mapScale: 1, mapX: 0, mapY: 0, mapPark: null,
  tmap: null, tmapView: null, tmapFocus: null,   // 在线地图实例 / 视图记忆 / 待聚焦园区
  session: { visitor: null, admin: null, viewed: [] },
  accountMessages: [],   // 登录账号的留言（只在内存，不写入本机缓存）
  accountLoading: false,
  accountError: '',
  accountEmailDraft: '', // 登录面板切换视图时保留已输入的邮箱
  form: { photos: [], editId: null, replaceIdx: -1, photosTouched: false },
  pendingInquiry: null,   // 未登录时暂存的留言内容，登录后自动带出
  share: null             // 当前分享上下文
};

/* ---------------- 数据查询 ---------------- */
function onlineListings() { return Api.db.listings.filter(l => l.status === 'online'); }
function findListing(id) { return Api.db.listings.find(l => l.id === id); }

/* Shared matching for the search box, requirement matching and filter panel. */
function searchText(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ''); }
function sameFacing(value, wanted) { return searchText(value).replace(/朝|向|通透|正/g, '') === searchText(wanted).replace(/朝|向|通透|正/g, ''); }
function hasLayout(value, wanted) { return searchText(value).split(/[，,、;；/\s]+/).includes(searchText(wanted)); }
function listingHasLayout(l,wanted) { return hasLayout(l.layout,wanted)||(wanted==='整层'&&/整层/.test(l.title||'')); }
function hasDecoration(value, wanted) {
  const text=searchText(value), want=searchText(wanted);
  if (/带家具/.test(want)) return /家具/.test(text)&&(!/精装/.test(want)||/精装/.test(text));
  if (/精装/.test(want)) return /精装/.test(text);
  return text.includes(want);
}
function rangeLabel(value, key) {
  if(value==='全部')return '不限';
  const [min,max]=value.split('-'), unit=key==='rent'?'元/㎡·月':'㎡';
  return max?`${min}–${max}${unit}`:`${min}${unit}以上`;
}
function parseListingQuery(query) {
  let rest=String(query||'').normalize('NFKC').toLowerCase();
  const c={areaMin:null,areaMax:null,rentMin:null,rentMax:null,monthlyMax:null,monthlyIncludesFee:window.SiteFees.feeMode(rest)===true,usage:'',facing:'',layout:'',decoration:'',furniture:false,excludeBare:false,terms:[],summary:[]};
  const take=(regex,apply)=>{rest=rest.replace(regex,(...args)=>{apply(args);return ' ';});};
  take(/(?:面积\s*)?(\d+(?:\.\d+)?)\s*(?:-|~|～|—|–|到|至)\s*(\d+(?:\.\d+)?)\s*(?:平方米|平米|平|㎡|m2|m²)/g,m=>{c.areaMin=Math.min(+m[1],+m[2]);c.areaMax=Math.max(+m[1],+m[2]);c.summary.push(`面积 ${c.areaMin}–${c.areaMax}㎡`);});
  take(/(至少|最少|不小于|不低于|不超过|最多|不大于)?\s*(\d+(?:\.\d+)?)\s*(?:平方米|平米|平|㎡|m2|m²)\s*(以上|以下|以内|左右)?/g,m=>{
    const n=+m[2], low=/至少|最少|不小于|不低于/.test(m[1]||'')||m[3]==='以上',high=/不超过|最多|不大于/.test(m[1]||'')||/以下|以内/.test(m[3]||'');
    c.areaMin=high?null:low?n:n*.8;c.areaMax=low?null:high?n:n*1.2;
    c.summary.push(low?`面积至少 ${n}㎡`:high?`面积不超过 ${n}㎡`:`面积 ${n}㎡左右（±20%）`);
  });
  take(/(?:每月预算|月租金|月预算|月租|每月|总预算)\s*(?:不超过|最多|在)?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*元?\s*(?:以内|以下|左右)?/g,m=>{c.monthlyMax=+m[1]*(m[2]==='万'?10000:m[2]==='千'?1000:1);c.summary.push(`${c.monthlyIncludesFee?'租金与物业每月合计':'月租金'}不超过 ${c.monthlyMax} 元（${c.monthlyIncludesFee?'租金+物业费':'不含物业费'}）`);});
  take(/(?:预算\s*)?(?:不超过|最多)?\s*(\d+(?:\.\d+)?)\s*(万|千)?\s*元\s*(?:\/月|每月|一个月)/g,m=>{c.monthlyMax=+m[1]*(m[2]==='万'?10000:m[2]==='千'?1000:1);c.summary.push(`${c.monthlyIncludesFee?'租金与物业每月合计':'月租金'}不超过 ${c.monthlyMax} 元（${c.monthlyIncludesFee?'租金+物业费':'不含物业费'}）`);});
  take(/(?:预算|租金|单价)?\s*(\d+(?:\.\d+)?)\s*(?:-|~|～|到|至)\s*(\d+(?:\.\d+)?)\s*元(?:\/(?:㎡|m2)(?:·月)?)?/g,m=>{c.rentMin=Math.min(+m[1],+m[2]);c.rentMax=Math.max(+m[1],+m[2]);c.summary.push(`租金单价 ${c.rentMin}–${c.rentMax} 元/㎡·月`);});
  take(/(?:预算|租金|单价)\s*(?:不超过|最多|在)?\s*(\d+(?:\.\d+)?)\s*元?(?:\/(?:㎡|m2)(?:·月)?)?\s*(?:以内|以下|左右)?|(?:不超过|最多)?\s*(\d+(?:\.\d+)?)\s*元\s*(?:以内|以下|左右)?/g,m=>{c.rentMax=+(m[1]||m[2]);c.summary.push(`租金单价不超过 ${c.rentMax} 元/㎡·月`);});
  take(/写字楼|办公楼|办公室|研发办公|厂房|工厂|仓库|仓储/g,m=>{c.usage=/厂房|工厂/.test(m[0])?'厂房':/仓库|仓储/.test(m[0])?'仓储':m[0]==='研发办公'?'研发办公':'写字楼';});
  if(c.usage)c.summary.push(c.usage);
  take(/不要毛坯|不考虑毛坯|非毛坯/g,()=>{c.excludeBare=true;c.summary.push('非毛坯');});
  take(/带家具精装|带家具|配家具|有家具/g,m=>{c.furniture=true;if(/精装/.test(m[0]))c.decoration='精装修';c.summary.push(m[0]);});
  take(/精装修|精装|简装修|简装|毛坯|豪装/g,m=>{c.decoration=m[0].replace('简装修','简装').replace(/^精装$/,'精装修');c.summary.push(c.decoration);});
  take(/整层|大开间|\d+\s*\+\s*\d+/g,m=>{c.layout=m[0].replace(/\s/g,'');c.summary.push(c.layout);});
  take(/南北通透|东西通透|(?:朝|向)(?:南北|东西|东南|东北|西南|西北|正南|正北|南|北|东|西)(?:向)?|(?:南北|东西|东南|东北|西南|西北|正南|正北|南|北|东|西)向|(?:^|[\s，,])(?:东南|东北|西南|西北|南|北|东|西)(?=$|[\s，,])/g,m=>{c.facing=m[0].trim().replace('正','');c.summary.push(c.facing);});
  rest=rest.replace(/不(?:包)?含(?:物业|管理)费?|(?:物业|管理)费另计|(?:包)?含(?:物业|管理)费?|房租加物业|租金加物业|合计|我想找|帮我找|我需要|我想要|我要|想找|需要|找个|找一套|找一个|的房源|房源|房子|面积|预算|租金|单价|附近|左右|带装修|带装|装修|有没有|可以吗|请问|最好|以内|以下|以上|左右|一套|一个|有隔间|隔间|的|要|在|找|和|有|吗|吧|呀|呢|元\/㎡·月/g,' ');
  if(/有隔间|隔间/.test(query)){c.rooms=true;c.summary.push('有隔间');}
  if(/带装修|带装/.test(query)&&!c.decoration){c.excludeBare=true;c.summary.push('带装修');}
  c.terms=rest.split(/[\s，,、。.!！?？；;]+/).map(searchText).filter(Boolean);
  if(c.terms.length)c.summary.push('关键词：'+c.terms.join('、'));
  return c;
}
function matchesListingQuery(l,c) {
  const area=Number(l.area),rent=l.rent==null?null:Number(l.rent);
  if(c.areaMin!==null&&(!area||area<c.areaMin))return false;
  if(c.areaMax!==null&&(!area||area>c.areaMax))return false;
  if(c.rentMin!==null&&(rent===null||rent<c.rentMin))return false;
  if(c.rentMax!==null&&(rent===null||rent>c.rentMax))return false;
  if(c.monthlyMax!==null&&!window.SiteFees.withinBudget(l.area,l.rent,l.propertyFee,c.monthlyMax,c.monthlyIncludesFee))return false;
  if(c.usage&&l.usage!==c.usage)return false;
  if(c.facing&&!sameFacing(l.orientation,c.facing))return false;
  if(c.layout&&!listingHasLayout(l,c.layout))return false;
  if(c.decoration&&!hasDecoration(l.decoration,c.decoration))return false;
  if(c.furniture&&!/家具/.test(l.decoration||''))return false;
  if(c.excludeBare&&(!l.decoration||/毛坯|待补充/.test(l.decoration)))return false;
  if(c.rooms&&!/隔间|\d+\s*\+\s*\d+/.test(l.layout||''))return false;
  const haystack=searchText([l.title,l.parkName,l.building,l.address,l.layout,l.decoration,l.orientation,l.desc].join(' '));
  return c.terms.every(term=>haystack.includes(term));
}
function applyFilters(list, f) {
  let out = list.slice();
  const kw=(f.kw||'').trim();
  const exactCode=window.SiteListingCodes?.parse(kw);
  if(exactCode)return out.filter(l=>l.listingCode===exactCode);
  if(kw){
    const ids=window.HomeSearch?.matchIds(kw);
    if(ids!==null&&ids!==undefined){out=out.filter(l=>ids.includes(l.id));if(!f.sort||f.sort==='default')out.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));}
    else{const criteria=parseListingQuery(kw);out=out.filter(l=>matchesListingQuery(l,criteria));}
  }
  if(f.usage&&f.usage!=='全部')out=out.filter(l=>(l.usage||'写字楼')===f.usage);
  if(f.park&&f.park!=='全部')out=out.filter(l=>l.parkName===f.park);
  if(f.orientation&&f.orientation!=='全部')out=out.filter(l=>sameFacing(l.orientation,f.orientation));
  if(f.decoration&&f.decoration!=='全部')out=out.filter(l=>hasDecoration(l.decoration,f.decoration));
  if(f.layout&&f.layout!=='全部')out=out.filter(l=>listingHasLayout(l,f.layout));
  for(const key of ['area','rent']){
    if(!f[key]||f[key]==='全部')continue;
    const [min,max]=f[key].split('-').map(Number);
    out=out.filter(l=>l[key]!=null&&Number.isFinite(Number(l[key]))&&Number(l[key])>=min&&(!max||Number(l[key])<=max));
  }
  const numeric=(a,b,key,desc=false)=>{
    const x=a[key]==null?null:Number(a[key]),y=b[key]==null?null:Number(b[key]);
    if(x===null)return y===null?0:1;if(y===null)return -1;
    return desc?y-x:x-y;
  };
  switch(f.sort){
    case 'rent-asc':out.sort((a,b)=>numeric(a,b,'rent'));break;
    case 'rent-desc':out.sort((a,b)=>numeric(a,b,'rent',true));break;
    case 'area-desc':out.sort((a,b)=>numeric(a,b,'area',true));break;
    case 'views':out.sort((a,b)=>numeric(a,b,'views',true));break;
    case 'new':out.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));break;
  }
  return out;
}
