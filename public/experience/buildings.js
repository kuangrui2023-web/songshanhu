/* 楼栋楼层导览（前台）
   数据来自 Supabase 的 public_buildings / public_building_units 视图，企业来自
   public_companies 视图（已打码）。首页只展示后台标记为「已发布」的楼栋。
   依赖 app.js 的全局函数：esc()、State、setView()、render()、toast()、sheetInquiry()。 */
(function () {
  const cfg = window.__SITE_BACKEND__ || {};
  const base = String(cfg.url || '').replace(/\/$/, '');
  const key = String(cfg.key || '');
  const FLOOR_BADGE = { vacant: '空置', reserved: '预留' };

  const state = {
    buildings: [], units: [], loading: false, loaded: false,
    error: '', errorCode: '',
  };

  /* ---------------- 数据 ---------------- */
  async function load(force) {
    if (state.loading || (state.loaded && !force)) return;
    if (!base || !key) {
      state.loaded = true;
      state.error = '网站数据服务尚未连接，请联系网站管理员。';
      state.errorCode = 'CONFIG_MISSING';
      if (typeof render === 'function') render();
      return;
    }
    state.loading = true; state.error = ''; state.errorCode = '';
    const gate = new AbortController();
    const timer = setTimeout(() => gate.abort(), 15000);
    try {
      const common = { headers: { apikey: key, Authorization: 'Bearer ' + key }, cache: 'no-store', signal: gate.signal };
      const [buildingRes, unitRes] = await Promise.all([
        fetch(base + '/rest/v1/public_buildings?select=*&order=sort_order.asc,name.asc&limit=500', common),
        fetch(base + '/rest/v1/public_building_units?select=*&order=floor_no.desc.nullslast,room.asc&limit=5000', common),
      ]);
      if (!buildingRes.ok || !unitRes.ok) {
        const failed = !buildingRes.ok ? buildingRes : unitRes;
        const error = new Error('HTTP ' + failed.status);
        error.status = failed.status;
        throw error;
      }
      const [buildings, units] = await Promise.all([buildingRes.json(), unitRes.json()]);
      state.buildings = Array.isArray(buildings) ? buildings.map(normalizeBuilding) : [];
      state.units = Array.isArray(units) ? units.map(normalizeUnit) : [];
      state.loaded = true;
    } catch (error) {
      state.errorCode = error.status ? 'HTTP_' + error.status : (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
      state.error = '暂时无法读取楼栋资料，请检查网络后重试。';
      state.buildings = [];
      state.units = [];
    } finally {
      clearTimeout(timer);
      state.loading = false;
      if (typeof render === 'function') render();
      /* 深链直接打开楼栋页时，标题要等数据读到后才能确定 */
      if (typeof syncTitle === 'function' && typeof State === 'object' && State.view === 'building') syncTitle();
    }
  }

  function normalizeBuilding(row) {
    return {
      id: row.id,
      name: String(row.name || '').trim(),
      region: row.region || '',
      address: row.address || '',
      floorsCount: row.floors_count == null ? null : Number(row.floors_count),
      coverUrl: row.cover_url || '',
      description: row.description || '',
      highlights: Array.isArray(row.highlights) ? row.highlights.filter(Boolean) : [],
      sortOrder: Number(row.sort_order || 0),
    };
  }

  function normalizeUnit(row) {
    return {
      id: row.id,
      buildingId: row.building_id,
      floor: String(row.floor || '').trim(),
      floorNo: row.floor_no == null ? null : Number(row.floor_no),
      room: row.room || '',
      area: row.area == null ? null : Number(row.area),
      rent: row.rent == null ? null : Number(row.rent),
      fee: row.fee == null ? null : Number(row.fee),
      orientation: row.orientation || '',
      decoration: row.decoration || '',
      status: row.status || 'vacant',
      note: row.note || '',
    };
  }

  /* ---------------- 小工具 ---------------- */
  const normalizeText = (value) => String(value || '').replace(/[\s·・]/g, '').toLowerCase();
  function sameBuilding(a, b) {
    const x = normalizeText(a), y = normalizeText(b);
    if (!x || !y) return false;
    if (x === y) return true;
    return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
  }
  function companyItems() {
    const box = window.SiteCompanies && window.SiteCompanies.state;
    return box && Array.isArray(box.items) ? box.items : [];
  }
  function companiesLoading() {
    const box = window.SiteCompanies && window.SiteCompanies.state;
    return Boolean(box && box.loading && !box.items.length);
  }
  function buildingCompanies(building) {
    /* 有 building_id 时按稳定 ID 匹配；老数据没有 ID 才退回按名称匹配。 */
    return companyItems().filter((item) => item.buildingId
      ? item.buildingId === building.id
      : sameBuilding(item.building, building.name));
  }
  function buildingUnits(building) {
    return state.units.filter((unit) => unit.buildingId === building.id);
  }

  const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  function cnNumber(value) {
    if (/^\d+$/.test(value)) return Number(value);
    if (value === '十') return 10;
    const m = value.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
    if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
    if (value.length === 1 && value in CN_NUM) return CN_NUM[value];
    return null;
  }
  /** 12F / 12楼 / 十二层 / B1 / 负一层 → 用于排序的整数 */
  function parseFloorNo(value) {
    const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) return null;
    if (/^(首层|地面层|大堂层)$/.test(raw)) return 1;
    const basement = raw.match(/^(?:B|负|地下)(.+)$/);
    if (basement) {
      const n = cnNumber(basement[1].replace(/[层楼F]$/, ''));
      return n === null ? null : -n;
    }
    const digits = raw.match(/-?\d+/);
    if (digits) return Number(digits[0]);
    return cnNumber(raw.replace(/[层楼F]$/, ''));
  }
  function floorText(no) {
    if (no === null || no === undefined) return '楼层待补充';
    return no < 0 ? 'B' + Math.abs(no) : no + 'F';
  }
  function floorNoOf(item) {
    const parsed = parseFloorNo(item.floor);
    return parsed === null ? (Number.isFinite(item.floorNo) ? item.floorNo : null) : parsed;
  }
  function numberText(value) {
    if (value == null || !Number.isFinite(Number(value))) return '';
    const n = Number(value);
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  function shortCompany(name) {
    const clean = String(name || '')
      .replace(/^(东莞市|东莞|广东省|广东|深圳市|深圳|广州市|广州)/, '')
      .replace(/[（(].*?[)）]/g, '')
      .replace(/(有限责任公司|股份有限公司|有限公司|集团)$/, '');
    return clean || name;
  }
  function initial(name) {
    return shortCompany(name).slice(0, 2);
  }
  function safeUrl(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^\/[^/]/.test(text)) return text;
    return '';
  }
  function areaText(units) {
    const total = units.reduce((sum, unit) => sum + (unit.area || 0), 0);
    return total ? numberText(total) + '㎡' : '—';
  }

  /* ---------------- 首页板块 ---------------- */
  function homeSection() {
    if (!state.buildings.length) {
      if (state.loading) return `<section class="building-home" aria-live="polite"><div class="building-home-head"><h2>楼栋导览</h2></div><p class="building-note">正在读取楼栋资料…</p></section>`;
      return '';
    }
    return `<section class="building-home" aria-labelledby="buildingHomeTitle">
      <div class="building-home-head">
        <div><h2 id="buildingHomeTitle">楼栋导览</h2><p>点进一栋楼，看每层已入驻的企业和空置办公室。</p></div>
        <span class="building-home-count">${state.buildings.length} 栋</span>
      </div>
      <div class="building-home-grid ${state.buildings.length === 1 ? 'is-single' : ''}">
        ${state.buildings.map(homeCard).join('')}
      </div>
    </section>`;
  }

  function homeCard(building) {
    const companies = buildingCompanies(building);
    const units = buildingUnits(building).filter((unit) => unit.status === 'vacant' || unit.status === 'reserved');
    const vacant = units.filter((unit) => unit.status === 'vacant');
    const cover = safeUrl(building.coverUrl);
    const pending = companiesLoading();
    return `<button type="button" class="building-card" data-act="open:building" data-id="${esc(building.id)}" aria-label="查看 ${esc(building.name)} 的楼层导览">
      <span class="building-card-media ${cover ? 'has-photo' : ''}">
        ${cover ? `<img src="${esc(cover)}" alt="${esc(building.name)}" loading="lazy">` : `<span class="building-card-fallback" aria-hidden="true"><i>${esc(initial(building.name))}</i><em>${esc(building.name)}</em></span>`}
        <span class="building-card-region">${esc(building.region || '松山湖')}</span>
      </span>
      <span class="building-card-body">
        <span class="building-card-kicker">${building.floorsCount ? building.floorsCount + ' 层' : '楼层资料整理中'}${building.address ? ' · ' + esc(building.address) : ''}</span>
        <span class="building-card-title">${esc(building.name)}</span>
        <span class="building-card-desc">${esc(building.description || '查看每层入驻企业与空置办公室，按楼层快速找到合适位置。')}</span>
        ${building.highlights.length ? `<span class="building-card-tags">${building.highlights.slice(0, 4).map((tag) => `<i>${esc(tag)}</i>`).join('')}</span>` : ''}
        <span class="building-card-stats">
          <span><b>${pending ? '—' : companies.length}</b><em>家入驻企业</em></span>
          <span><b>${vacant.length}</b><em>套空置办公室</em></span>
          <span><b>${areaText(vacant)}</b><em>空置面积</em></span>
        </span>
        <span class="building-card-open">查看楼层导览 <span aria-hidden="true">→</span></span>
      </span>
    </button>`;
  }

  /* ---------------- 楼栋详情 ---------------- */
  function renderBuilding() {
    const id = State && State.params ? State.params.buildingId : '';
    const building = state.buildings.find((item) => item.id === id);
    if (!building) {
      if (state.loading) return `<div class="building-page"><div class="building-empty" role="status"><div class="spinner" style="margin:40px auto 16px"></div>正在读取楼栋资料…</div></div>`;
      return `<div class="building-page"><div class="building-empty">没有找到这栋楼，可能已下架。<br><button type="button" class="result-reset" data-act="tab" data-v="home">返回首页</button></div></div>`;
    }
    const companies = buildingCompanies(building);
    const units = buildingUnits(building).filter((unit) => unit.status === 'vacant' || unit.status === 'reserved');
    const vacant = units.filter((unit) => unit.status === 'vacant');
    const floors = new Map();
    const floorPending = [];
    const addFloor = (no) => {
      if (!floors.has(no)) floors.set(no, { no, companies: [], units: [] });
      return floors.get(no);
    };
    companies.forEach((company) => {
      const no = floorNoOf(company);
      if (no === null) { floorPending.push(company); return; }
      addFloor(no).companies.push(company);
    });
    units.forEach((unit) => {
      const no = floorNoOf(unit);
      if (no === null) return;
      addFloor(no).units.push(unit);
    });
    const floorList = [...floors.values()].sort((a, b) => b.no - a.no);
    const companyList = companies.slice().sort((a, b) => {
      const fa = floorNoOf(a), fb = floorNoOf(b);
      if (fa === null && fb !== null) return 1;
      if (fa !== null && fb === null) return -1;
      if (fa !== fb) return (fb || 0) - (fa || 0);
      return String(a.room || '').localeCompare(String(b.room || ''), 'zh-Hans-CN');
    });
    const cover = safeUrl(building.coverUrl);
    const pending = companiesLoading();
    const compactList = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 640px)').matches;

    return `<div class="building-page">
      <div class="building-hero ${cover ? 'has-photo' : ''}">
        <div class="building-hero-media">${cover ? `<img src="${esc(cover)}" alt="${esc(building.name)}">` : `<span class="building-card-fallback" aria-hidden="true"><i>${esc(initial(building.name))}</i><em>${esc(building.name)}</em></span>`}</div>
        <div class="building-hero-body">
          <button type="button" class="building-back" data-act="tab" data-v="home">← 返回首页</button>
          <span class="building-hero-kicker">${esc(building.region || '松山湖')}${building.floorsCount ? ' · ' + building.floorsCount + ' 层' : ''}</span>
          <h2>${esc(building.name)}</h2>
          ${building.address ? `<p class="building-hero-address">${esc(building.address)}</p>` : ''}
          ${building.description ? `<p class="building-hero-desc">${esc(building.description)}</p>` : ''}
          ${building.highlights.length ? `<div class="building-hero-tags">${building.highlights.map((tag) => `<i>${esc(tag)}</i>`).join('')}</div>` : ''}
          <div class="building-hero-stats">
            <div><b>${pending ? '—' : companies.length}</b><span>家入驻企业</span></div>
            <div><b>${vacant.length}</b><span>套空置办公室</span></div>
            <div><b>${areaText(vacant)}</b><span>空置面积</span></div>
          </div>
          <button type="button" class="building-hero-cta" data-act="building:inquiry" data-id="">咨询这栋楼</button>
          <div class="building-hero-companies">
            <div class="building-companies-head">
              <h3>入驻企业</h3>
              <span>${pending ? '读取中…' : '共 ' + companies.length + ' 家' + (companies.length > (compactList ? 4 : 8) ? ' · 可滚动' : '')}</span>
            </div>
            ${companies.length
              ? `<div class="building-company-list" tabindex="0" role="group" aria-label="${esc(building.name)}的入驻企业">${companyList.map(companyItem).join('')}</div>`
              : `<p class="building-companies-empty">${pending ? '正在读取企业资料…' : '这栋楼暂时没有公开的企业资料，可以点「咨询这栋楼」了解。'}</p>`}
          </div>
        </div>
      </div>

      <div class="building-floor-head">
        <div><h3>楼层导览</h3><p>鼠标移到格子上看详情；手机上点一下格子。格子里的企业信息已做隐私打码。</p></div>
        <div class="building-legend"><span><i class="dot occupied"></i>入驻企业</span><span><i class="dot vacant"></i>空置</span><span><i class="dot reserved"></i>预留</span></div>
      </div>

      ${floorList.length ? `<div class="floor-stack">${floorList.map(floorRow).join('')}</div>` : `<div class="building-empty">这栋楼的楼层资料还在整理中。可以点「咨询这栋楼」留下需求，招商顾问会帮你确认。</div>`}

      ${floorPending.length ? `<div class="building-pending"><h3>楼层待补充的企业</h3><p>以下企业已入驻，但楼层资料还没整理好。</p><div class="building-pending-list">${floorPending.map((company) => `<button type="button" data-act="open:company" data-id="${esc(company.id)}">${esc(company.name)}${company.room ? `<small>${esc(company.room)}</small>` : ''}</button>`).join('')}</div></div>` : ''}

      <p class="building-floor-note">楼层导览只展示已整理的楼层；未列出的楼层可能仍有房源。具体面积、租金和交付条件以招商顾问现场确认为准。</p>

      <div class="floor-pop-mask" id="floorPopMask" data-act="building:pop-close" hidden></div>
      <div class="floor-pop" id="floorPop" role="dialog" aria-label="楼层详情" hidden></div>
    </div>`;
  }

  function companyItem(company) {
    const no = floorNoOf(company);
    const meta = [no === null ? '楼层待补充' : floorText(no), company.room, company.industry].filter(Boolean).join(' · ');
    return `<button type="button" class="building-company" data-act="open:company" data-id="${esc(company.id)}" title="${esc(company.name)}">
      <span class="building-company-name">${esc(company.name)}</span>
      <span class="building-company-meta">${esc(meta)}</span>
    </button>`;
  }

  function floorRow(floor) {
    const companies = floor.companies.slice().sort((a, b) => String(a.room || '').localeCompare(String(b.room || ''), 'zh-Hans-CN'));
    const units = floor.units.slice().sort((a, b) => String(a.room || '').localeCompare(String(b.room || ''), 'zh-Hans-CN'));
    const total = companies.length + units.length;
    return `<div class="floor-row">
      <div class="floor-label"><b>${esc(floorText(floor.no))}</b><span>${total} 格</span></div>
      <div class="floor-cells">
        ${companies.map((company) => `<button type="button" class="unit-cell occupied" data-act="building:cell" data-kind="company" data-id="${esc(company.id)}" aria-label="${esc(company.name)}，查看企业信息">
          <span class="unit-cell-main">${esc(shortCompany(company.name))}</span>
          <span class="unit-cell-meta">${esc([company.room, company.industry].filter(Boolean).join(' · ') || '入驻企业')}</span>
        </button>`).join('')}
        ${units.map((unit) => `<button type="button" class="unit-cell ${unit.status}" data-act="building:cell" data-kind="unit" data-id="${esc(unit.id)}" aria-label="${esc(floorText(floor.no) + ' ' + (unit.room || '整层'))}，${esc(FLOOR_BADGE[unit.status] || '空置')}，查看详情">
          <span class="unit-cell-main">${esc(unit.room || '整层')}</span>
          <span class="unit-cell-meta">${esc([unit.area == null ? '' : numberText(unit.area) + '㎡', unit.rent == null ? '' : numberText(unit.rent) + ' 元/㎡'].filter(Boolean).join(' · ') || (FLOOR_BADGE[unit.status] || '空置'))}</span>
        </button>`).join('')}
      </div>
    </div>`;
  }

  /* ---------------- 悬停 / 点按小窗 ---------------- */
  let hideTimer = 0;

  function findCompany(id) {
    return companyItems().find((item) => item.id === id);
  }
  function findUnit(id) {
    return state.units.find((item) => item.id === id);
  }

  function popMarkup(kind, item, building) {
    if (!item) return '';
    if (kind === 'company') {
      const facts = [
        ['楼层房号', [item.floor, item.room].filter(Boolean).join(' · ')],
        ['所属行业', item.industry],
        ['经营状态', item.status],
        ['人员规模', item.size],
      ].filter(([, value]) => value);
      return `<div class="floor-pop-head"><span class="floor-pop-badge occupied">入驻企业</span><b>${esc(item.name)}</b></div>
        ${facts.length ? `<dl class="floor-pop-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>` : ''}
        ${item.tags.length ? `<div class="floor-pop-tags">${item.tags.slice(0, 4).map((tag) => `<i>${esc(tag)}</i>`).join('')}</div>` : ''}
        <div class="floor-pop-actions"><button type="button" class="pri" data-act="open:company" data-id="${esc(item.id)}">查看企业资料</button></div>`;
    }
    const facts = [
      ['楼层', floorText(parseFloorNo(item.floor))],
      ['房号', item.room || '整层'],
      ['面积', item.area == null ? '' : numberText(item.area) + '㎡'],
      ['租金', item.rent == null ? '面议' : numberText(item.rent) + ' 元/㎡·月'],
      ['物业费', item.fee == null ? '面议' : numberText(item.fee) + ' 元/㎡·月'],
      ['朝向', item.orientation],
      ['装修', item.decoration],
    ].filter(([, value]) => value);
    return `<div class="floor-pop-head"><span class="floor-pop-badge ${item.status}">${esc(FLOOR_BADGE[item.status] || '空置')}</span><b>${esc(building.name)} · ${esc(floorText(parseFloorNo(item.floor)))}${item.room ? ' · ' + esc(item.room) : ''}</b></div>
      <dl class="floor-pop-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
      ${item.note ? `<p class="floor-pop-note">${esc(item.note)}</p>` : ''}
      <div class="floor-pop-actions"><button type="button" class="pri" data-act="building:inquiry" data-id="${esc(item.id)}">咨询这套办公室</button></div>`;
  }

  function showPop(cell) {
    const kind = cell.dataset.kind;
    const id = cell.dataset.id;
    const building = state.buildings.find((item) => item.id === (State.params.buildingId || ''));
    if (!building) return;
    const item = kind === 'company' ? findCompany(id) : findUnit(id);
    const pop = document.getElementById('floorPop');
    const mask = document.getElementById('floorPopMask');
    if (!pop || !item) return;
    clearTimeout(hideTimer);
    pop.innerHTML = popMarkup(kind, item, building);
    pop.hidden = false;
    pop.classList.add('is-open');
    const mobile = window.matchMedia('(hover: none)').matches;
    if (mask) mask.hidden = !mobile;
    document.body.classList.add('floor-pop-open');
    if (!mobile) requestAnimationFrame(() => placePop(pop, cell));
  }

  function placePop(pop, cell) {
    const rect = cell.getBoundingClientRect();
    const width = Math.min(330, window.innerWidth - 24);
    pop.style.width = width + 'px';
    const height = pop.offsetHeight;
    let left = rect.right + 10;
    if (left + width > window.innerWidth - 12) left = rect.left - width - 10;
    if (left < 12) left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
    let top = rect.top;
    if (top + height > window.innerHeight - 12) top = window.innerHeight - height - 12;
    if (top < 12) top = 12;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function hidePop() {
    clearTimeout(hideTimer);
    const pop = document.getElementById('floorPop');
    const mask = document.getElementById('floorPopMask');
    if (pop) { pop.hidden = true; pop.classList.remove('is-open'); }
    if (mask) mask.hidden = true;
    document.body.classList.remove('floor-pop-open');
  }
  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hidePop, 180);
  }

  function inquiryFor(unitId) {
    const building = state.buildings.find((item) => item.id === (State.params.buildingId || ''));
    const unit = unitId ? findUnit(unitId) : null;
    if (!building) return;
    const target = unit ? `${floorText(parseFloorNo(unit.floor))}${unit.room ? ' · ' + unit.room : '（整层）'}` : '整栋';
    const content = unit
      ? `我想了解「${building.name}」${target} 的空置办公室${unit.area ? `（${numberText(unit.area)}㎡）` : ''}，请招商顾问与我联系。`
      : `我想了解「${building.name}」的办公室，请招商顾问与我联系。`;
    hidePop();
    if (typeof sheetInquiry === 'function') sheetInquiry('', '其他问题', { content });
    else if (typeof toast === 'function') toast('请在「留言咨询」页面留下需求，招商顾问会与你联系');
  }

  /* ---------------- 事件 ---------------- */
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-act]');
    if (!el) {
      if (!event.target.closest('.floor-pop')) hidePop();
      return;
    }
    switch (el.dataset.act) {
      case 'open:building': {
        const id = el.dataset.id;
        if (!id) return;
        State.params.buildingId = id;
        hidePop();
        if (window.SiteCompanies) void window.SiteCompanies.load(false);
        void load(false);
        if (typeof setView === 'function') setView('building', true);
        break;
      }
      case 'building:cell':
        showPop(el);
        break;
      case 'building:pop-close':
        hidePop();
        break;
      case 'building:inquiry':
        inquiryFor(el.dataset.id || '');
        break;
      default:
        break;
    }
  });

  document.addEventListener('pointerover', (event) => {
    if (event.pointerType && event.pointerType !== 'mouse') return;
    const cell = event.target.closest('.unit-cell');
    if (!cell) return;
    if (event.relatedTarget && cell.contains(event.relatedTarget)) return;
    showPop(cell);
  });

  document.addEventListener('pointerout', (event) => {
    const cell = event.target.closest('.unit-cell');
    if (!cell) return;
    if (event.relatedTarget && cell.contains(event.relatedTarget)) return;
    if (event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.floor-pop')) return;
    hideSoon();
  });

  document.addEventListener('pointerover', (event) => {
    if (event.target.closest('.floor-pop')) clearTimeout(hideTimer);
  });
  document.addEventListener('pointerout', (event) => {
    if (event.target.closest('.floor-pop') && !(event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest('.floor-pop'))) hideSoon();
  });

  document.addEventListener('focusin', (event) => {
    const cell = event.target.closest('.unit-cell');
    if (cell) showPop(cell);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hidePop();
  });

  /* ---------------- 对外 ---------------- */
  window.SiteBuildings = {
    load,
    state,
    homeSection,
    open(id) {
      if (!id) return;
      State.params.buildingId = id;
      if (typeof setView === 'function') setView('building', true);
    },
  };
  window.renderBuilding = renderBuilding;

  void load(false);
})();
