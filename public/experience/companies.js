/* 入驻企业名录（前台）
   数据来自 Supabase 的 public_companies 视图：法人、电话、邮箱、统一代码在数据库里
   就已经脱敏，浏览器拿到的就是打码后的值，导出也一样。
   依赖 app.js 提供的全局函数：esc()、setView()、render()、State、toast()。 */
(function () {
  const cfg = window.__SITE_BACKEND__ || {};
  const base = String(cfg.url || '').replace(/\/$/, '');
  const key = String(cfg.key || '');
  const PAGE = 20;

  const state = {
    items: [], loading: false, loaded: false, error: '', errorCode: '',
    kw: '', park: '全部', industry: '全部', limit: PAGE,
  };

  /* esc / State / render / setView / toast 都是 data.js 与 app.js 里的全局函数，本文件在其后加载 */

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
    if (typeof render === 'function') render();
    const gate = new AbortController();
    const timer = setTimeout(() => gate.abort(), 15000);
    try {
      const url = base + '/rest/v1/public_companies?select=*&order=name.asc&limit=2000';
      const response = await fetch(url, {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        cache: 'no-store',
        signal: gate.signal,
      });
      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      const rows = await response.json();
      state.items = Array.isArray(rows) ? rows.map(normalize) : [];
      state.loaded = true;
    } catch (error) {
      state.errorCode = error.status ? 'HTTP_' + error.status : (error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
      state.error = error.status === 401 || error.status === 403
        ? '企业名录服务配置异常，请联系网站管理员。'
        : error.status === 429
          ? '访问较多，请稍后再试。'
          : '暂时无法连接企业名录服务，请检查网络后重试。';
      state.items = [];
    } finally {
      clearTimeout(timer);
      state.loading = false;
      if (typeof render === 'function') render();
    }
  }

  function normalize(row) {
    return {
      id: row.id,
      name: String(row.name || '').trim(),
      park: row.park || '',
      building: row.building || '',
      room: row.room || '',
      industry: row.industry || '',
      status: row.status || '',
      establishedOn: row.established_on || '',
      establishedYear: row.established_year || null,
      capital: row.registered_capital == null ? null : Number(row.registered_capital),
      size: row.employee_band || '',
      legal: row.legal_representative || '',
      phone: row.phone || '',
      email: row.email || '',
      code: row.unified_code || '',
      address: row.address || '',
      scope: row.business_scope || '',
      website: row.website || '',
      tags: Array.isArray(row.tags) ? row.tags.filter(Boolean) : [],
      updatedAt: row.updated_at || '',
    };
  }

  /* ---------------- 小工具 ---------------- */
  function money(value) {
    if (value == null || !Number.isFinite(value)) return '未公示';
    if (value >= 10000) {
      const yi = value / 10000;
      return (Number.isInteger(yi) ? yi : yi.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + ' 亿元';
    }
    return (Number.isInteger(value) ? value : value.toFixed(2)) + ' 万元';
  }
  function yearText(item) {
    if (item.establishedYear) return item.establishedYear + ' 年成立';
    if (item.establishedOn) return String(item.establishedOn).slice(0, 4) + ' 年成立';
    return '';
  }
  function whereText(item) {
    return [item.park, item.building, item.room].filter(Boolean).join(' · ');
  }
  function dateText(value) {
    const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return value || '';
    return `${m[1]} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
  }
  function initial(name) {
    const clean = name.replace(/^(东莞市|深圳市|广东省|广东|上海|广州)/, '').replace(/[（(].*?[)）]/g, '');
    return (clean || name).slice(0, 2);
  }
  const ONLINE = ['存续', '在业', '迁入'];

  function matches(item) {
    if (state.park !== '全部' && item.park !== state.park) return false;
    if (state.industry !== '全部' && item.industry !== state.industry) return false;
    const k = state.kw.trim().toLowerCase();
    if (!k) return true;
    return [item.name, item.industry, item.address, item.building, item.park, item.legal, (item.tags || []).join(' ')]
      .some(value => String(value || '').toLowerCase().includes(k));
  }
  const visible = () => state.items.filter(matches);

  function parks() {
    const names = [];
    state.items.forEach(item => { if (item.park && !names.includes(item.park)) names.push(item.park); });
    return names.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }
  function industries(list) {
    const counts = new Map();
    (list || visible()).forEach(item => {
      const name = item.industry || '未分类';
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hans-CN'));
  }
  const shortIndustry = name => String(name)
    .replace('科技推广和应用服务业', '科技推广')
    .replace('软件和信息技术服务业', '软件与信息')
    .replace('计算机、通信和其他电子设备制造业', '电子设备制造')
    .replace('商务服务业', '商务服务')
    .replace('研究和试验发展', '研发试验')
    .replace('专业技术服务业', '专业技术服务')
    .replace('餐饮业', '餐饮')
    .replace('通用设备制造业', '通用设备')
    .replace('专用设备制造业', '专用设备')
    .replace('电气机械和器材制造业', '电气机械')
    .replace('批发业', '批发')
    .replace('零售业', '零售');

  /* ---------------- 企业卡片 ---------------- */
  function card(item) {
    const meta = [item.industry, whereText(item), yearText(item), item.size].filter(Boolean);
    return `<button type="button" class="company-card" data-act="open:company" data-id="${esc(item.id)}" aria-label="查看 ${esc(item.name)} 详情">
      <span class="company-logo" aria-hidden="true">${esc(initial(item.name))}</span>
      <span class="company-card-main">
        <span class="company-card-name">${esc(item.name)}</span>
        <span class="company-card-meta">${meta.map(text => `<span>${esc(text)}</span>`).join('')}</span>
        ${item.tags.length ? `<span class="company-card-tags">${item.tags.slice(0, 3).map(tag => `<i>${esc(tag)}</i>`).join('')}</span>` : ''}
      </span>
      <span class="company-card-arrow" aria-hidden="true">›</span>
    </button>`;
  }

  /* ---------------- 首页板块 ---------------- */
  function homeSection() {
    if (state.error) return '';
    if (state.loading && !state.items.length) {
      return `<section class="company-home" aria-live="polite"><div class="company-home-head"><h2>入驻企业</h2></div><p class="company-note">正在读取企业名录…</p></section>`;
    }
    if (!state.items.length) return '';

    // 首页跟随「片区」筛选：选了松山湖北部就只看这个片区的企业
    const parkFilter = (State && State.filters && State.filters.park && State.filters.park !== '全部') ? State.filters.park : '全部';
    const scope = state.items.filter(item => parkFilter === '全部' || item.park === parkFilter);
    if (!scope.length) return '';
    const top = industries(scope).slice(0, 4);
    const area = [...new Set(scope.map(item => item.building).filter(Boolean))];
    const title = parkFilter === '全部' ? '入驻企业' : parkFilter + '入驻企业';

    return `<section class="company-home" aria-labelledby="companyHomeTitle">
      <div class="company-home-head">
        <h2 id="companyHomeTitle">${esc(title)}</h2>
        <button type="button" data-act="open:companies">查看全部 ${scope.length} 家 ›</button>
      </div>
      <div class="company-summary">
        <div><b>${scope.length}</b><span>家企业</span></div>
        <div><b>${new Set(scope.map(item => item.industry).filter(Boolean)).size}</b><span>个行业</span></div>
        <div><b>${area.length || '—'}</b><span>${area.length ? '栋楼宇' : '楼宇待补充'}</span></div>
      </div>
      <div class="company-industry-chips">
        ${top.map(([name, count]) => `<button type="button" data-act="companies:industry" data-v="${esc(name)}">${esc(shortIndustry(name))} ${count}</button>`).join('')}
      </div>
      <div class="company-home-list">${scope.slice(0, 3).map(card).join('')}</div>
      <button type="button" class="company-home-more" data-act="open:companies">浏览企业名录 ›</button>
    </section>`;
  }

  /* ---------------- 名录页 ---------------- */
  function chart(list) {
    const rows = industries(list).slice(0, 8);
    if (rows.length < 2) return '';
    const max = rows[0][1] || 1;
    return `<figure class="industry-chart" aria-label="行业分布：${rows.map(([name, count]) => shortIndustry(name) + ' ' + count + ' 家').join('，')}">
      <h3>行业分布</h3>
      <p>按企业数量排序，前 ${rows.length} 个行业</p>
      <dl>
        ${rows.map(([name, count]) => `<div class="industry-row">
          <dt title="${esc(name)}">${esc(shortIndustry(name))}</dt>
          <span class="industry-track"><span class="industry-fill" style="width:${Math.max(2, Math.round(count / max * 100))}%"></span></span>
          <dd>${count}</dd>
        </div>`).join('')}
      </dl>
    </figure>`;
  }

  function renderCompanies() {
    if (state.loading && !state.items.length) {
      return `<div class="companies-page"><div class="companies-title"><h2>入驻企业名录</h2><p>正在读取企业资料…</p></div>
        <div class="company-list">${Array.from({ length: 3 }, () => '<div class="company-card"><span class="company-logo">·</span><span class="company-card-main"><span class="company-card-name">正在加载</span><span class="company-card-meta"><span>请稍候</span></span></span></div>').join('')}</div></div>`;
    }
    if (state.error) {
      return `<div class="companies-page"><div class="companies-title"><h2>入驻企业名录</h2><p>${esc(state.error)}</p></div>
        <div class="company-empty"><button type="button" data-act="companies:retry">重新加载</button></div></div>`;
    }
    if (!state.items.length) {
      return `<div class="companies-page"><div class="companies-title"><h2>入驻企业名录</h2></div><div class="company-empty">还没有发布入驻企业</div></div>`;
    }

    const allParks = parks();
    const total = state.items.length;

    return `<div class="companies-page">
      <div class="companies-title">
        <h2>入驻企业名录</h2>
        <p>共 ${total} 家 · ${esc([...new Set(state.items.map(item => item.building).filter(Boolean))].join('、') || '楼宇信息待补充')} · 资料来自公开工商信息</p>
      </div>
      <div class="company-toolbar">
        <label class="company-search">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4" stroke-linecap="round"/></svg>
          <input id="companySearch" type="search" enterkeyhint="search" placeholder="搜索企业名称、行业、地址" value="${esc(state.kw)}" aria-label="搜索入驻企业">
        </label>
        <button type="button" class="company-export" data-act="companies:export">导出</button>
      </div>
      ${allParks.length > 1 ? `<div class="company-chips" role="group" aria-label="按片区筛选">
        ${['全部', ...allParks].map(name => `<button type="button" class="${state.park === name ? 'on' : ''}" data-act="companies:park" data-v="${esc(name)}" aria-pressed="${state.park === name}">${esc(name === '全部' ? '全部片区' : name)}</button>`).join('')}
      </div>` : ''}
      ${state.industry !== '全部' ? `<div class="company-chips"><button type="button" class="on" data-act="companies:industry" data-v="全部">${esc(shortIndustry(state.industry))} ×</button></div>` : ''}
      <div id="companyResults">${resultsHTML()}</div>
    </div>`;
  }

  /** 结果区（数量 + 行业图 + 企业列表）单独渲染，搜索时只换这一块 */
  function resultsHTML() {
    const list = visible();
    const shown = list.slice(0, state.limit);
    const total = state.items.length;
    return `<p class="company-count">${list.length === total ? `共 ${total} 家` : `筛出 ${list.length} 家（全部 ${total} 家）`}</p>
      ${chart(list)}
      ${list.length ? `<div class="company-list">${shown.map(card).join('')}</div>` : `<div class="company-empty">没有符合条件的企业<br><button type="button" data-act="companies:clear">清除筛选</button></div>`}
      ${shown.length < list.length ? `<button type="button" class="company-loadmore" data-act="companies:more">显示更多（还剩 ${list.length - shown.length} 家）</button>` : ''}
      ${list.length ? `<p class="company-note">法人姓名、联系电话与邮箱已做脱敏处理；企业资料由公开渠道整理，如需联系入驻企业，请通过招商顾问对接。</p>` : ''}`;
  }

  /** 只重绘结果区：搜索框不重建，焦点和中文输入法的候选字都不会被打断 */
  function paint() {
    const box = document.getElementById('companyResults');
    if (box) box.innerHTML = resultsHTML();
    else if (typeof render === 'function') {
      render();
    }
  }

  /* ---------------- 详情页 ---------------- */
  function renderCompany() {
    const id = State && State.params ? State.params.companyId : '';
    const item = state.items.find(entry => entry.id === id);
    if (!item) {
      if (state.loading) return `<div class="company-detail"><div class="company-empty">正在读取企业资料…</div></div>`;
      return `<div class="company-detail"><div class="company-empty">没有找到这家企业<br><button type="button" data-act="open:companies">返回企业名录</button></div></div>`;
    }
    const facts = [
      ['所属园区', whereText(item)],
      ['所属行业', item.industry],
      ['经营状态', item.status],
      ['成立时间', dateText(item.establishedOn)],
      ['注册资本', item.capital == null ? '未公示' : money(item.capital)],
      ['人员规模', item.size],
      ['法定代表人', item.legal],
      ['联系电话', item.phone],
      ['邮箱', item.email],
      ['统一代码', item.code],
      ['注册地址', item.address],
    ].filter(([, value]) => value);

    return `<div class="company-detail">
      <div class="company-detail-head">
        <span class="company-logo" aria-hidden="true">${esc(initial(item.name))}</span>
        <div>
          <h2>${esc(item.name)}</h2>
          <div class="company-detail-sub">
            ${item.industry ? `<span>${esc(item.industry)}</span>` : ''}
            <span class="${ONLINE.includes(item.status) ? 'company-state' : 'company-state off'}">${esc(item.status || '状态未知')}</span>
            ${yearText(item) ? `<span>${esc(yearText(item))}</span>` : ''}
            ${item.size ? `<span>${esc(item.size)}</span>` : ''}
          </div>
        </div>
      </div>

      <dl class="company-facts">
        ${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}
        ${item.website ? `<div><dt>官网</dt><dd><a href="${esc(safeUrl(item.website))}" target="_blank" rel="noopener noreferrer nofollow">${esc(item.website)}</a></dd></div>` : ''}
      </dl>

      <div class="company-mask-note">为保护企业隐私，法人姓名、电话、邮箱与统一社会信用代码均已打码。需要联系该企业，请由招商顾问协助对接。</div>

      ${item.tags.length ? `<div class="company-section"><h3>企业标签</h3><p>${esc(item.tags.join('、'))}</p></div>` : ''}
      ${item.scope ? `<div class="company-section"><h3>经营范围</h3><p>${esc(item.scope)}</p></div>` : ''}

      <div class="company-cta">
        <button type="button" class="pri" data-act="company:contact" data-name="${esc(item.name)}">联系招商顾问</button>
        <button type="button" class="ghost" data-act="open:companies">返回名录</button>
      </div>
    </div>`;
  }

  function safeUrl(value) {
    const text = String(value || '').trim();
    if (/^https?:\/\//i.test(text)) return text;
    return 'https://' + text.replace(/^\/+/, '');
  }

  /* ---------------- 导出（只导出打码后的前台字段） ---------------- */
  const EXPORT_COLUMNS = ['企业名称', '所属园区', '楼栋', '房号', '所属行业', '经营状态', '成立日期', '注册资本(万元)', '人员规模', '法定代表人', '联系电话', '邮箱', '统一社会信用代码', '注册地址', '官网', '标签'];

  function exportRows() {
    return visible().map(item => [
      item.name, item.park, item.building, item.room, item.industry, item.status,
      item.establishedOn, item.capital == null ? '' : String(item.capital), item.size,
      item.legal, item.phone, item.email, item.code, item.address, item.website, item.tags.join('、'),
    ]);
  }
  function cell(value) {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text; // 防 CSV 公式注入
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }
  function exportCsv() {
    const rows = exportRows();
    if (!rows.length) { if (typeof toast === 'function') toast('当前没有可导出的企业'); return; }
    const body = [EXPORT_COLUMNS, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
    // 加 BOM，Excel 双击打开中文不乱码
    const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const today = new Date();
    const stamp = today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
    link.href = URL.createObjectURL(blob);
    link.download = `松山湖入驻企业-${state.park === '全部' ? '全部片区' : state.park}-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
    if (typeof toast === 'function') toast(`已导出 ${rows.length} 家（联系方式为打码版本）`);
  }

  /* ---------------- 交互 ---------------- */
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const value = el.dataset.v;
    switch (act) {
      case 'open:companies':
        state.limit = PAGE;
        // 从首页进来时沿用首页选的片区，保证「查看全部 N 家」和名录页条数一致
        if (State.view === 'home' && State.filters && State.filters.park) {
          const park = State.filters.park;
          if (park === '全部' || state.items.some(item => item.park === park)) state.park = park;
        }
        if (typeof setView === 'function') setView('companies', true);
        break;
      case 'open:company': {
        const id = el.dataset.id;
        if (!id) return;
        State.params.companyId = id;
        if (typeof setView === 'function') setView('company', true);
        break;
      }
      case 'companies:industry':
        state.industry = value || '全部';
        state.limit = PAGE;
        // 首页的行业标签点下去要直接跳进名录页
        if (State.view === 'companies') { if (typeof render === 'function') render(); }
        else if (typeof setView === 'function') setView('companies', true);
        break;
      case 'companies:park':
        state.park = value || '全部';
        state.limit = PAGE;
        if (typeof render === 'function') render();
        break;
      case 'companies:more':
        state.limit += PAGE;
        if (typeof render === 'function') render();
        break;
      case 'companies:clear':
        state.kw = ''; state.park = '全部'; state.industry = '全部'; state.limit = PAGE;
        if (typeof render === 'function') render();
        break;
      case 'companies:export':
        exportCsv();
        break;
      case 'companies:retry':
        void load(true);
        break;
      case 'company:contact': {
        const name = el.dataset.name || '这家企业';
        if (typeof sheetInquiry === 'function') {
          sheetInquiry('', '其他问题', { content: `我想了解入驻企业「${name}」的情况，请招商顾问与我联系。` });
        } else if (typeof toast === 'function') {
          toast('请在「留言咨询」页面留下需求，招商顾问会与你联系');
        }
        break;
      }
      default: break;
    }
  });

  function onSearchInput(event) {
    if (event.target.id !== 'companySearch') return;
    state.kw = event.target.value || '';
    state.limit = PAGE;
    paint();
  }
  document.addEventListener('input', onSearchInput);
  document.addEventListener('search', onSearchInput); // 点输入框里的 × 清空时触发

  /* ---------------- 对外 ---------------- */
  window.SiteCompanies = { load, homeSection, state };
  window.renderCompanies = renderCompanies;
  window.renderCompany = renderCompany;

  // 首屏就开始拉，首页板块不用等用户点进名录
  void load(false);
})();
