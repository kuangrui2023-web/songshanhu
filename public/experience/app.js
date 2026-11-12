/* ============================================================
 * 松山湖写字楼招商小程序 · 视图与交互层
 * 角色：游客（浏览 / 留言咨询 / 拨打电话）+ 管理员（房源上下架 / 数据看板）
 * ============================================================ */

/* ---------------- 通用片段 ---------------- */
/* 园区列表统一入口：后台"园区管理"可增删改，存于 db.parks */
function parksAll() { return Api.db.parks || []; }

/* 照片地址：三件事一起做 ——
   ① demo: 短标记 → 即时生成演示图（演示图不进本机缓存，省空间）
   ② /api/photo/ 服务器相对路径 → 补成可访问的绝对地址（浏览器可缓存、HTML 更小）
   ③ data:/assets/ 等原样返回 */
function photoURL(p) {
  if (!p) return '';
  const real = (typeof expandPhoto === 'function') ? expandPhoto(p) : p;
  if (/^\/api\//.test(real)) return (typeof SHARE_BASE === 'string' ? SHARE_BASE : '') + real;
  return real;
}

/* ---------------- 存量 base64 照片迁移（自动、幂等） ----------------
   老版本把实拍照片以 base64 塞在房源数据里，是"手机本地存储不足"的根因
   （10 套房 + 5 份整库备份就能到 70MB，远超浏览器 5MB 上限）。

   处理顺序（安全第一）：
   ① 先把 base64 照片**上传到服务器**（本地文件 + 云端 photos 表双备份）
   ② 确认该房源照片已全部上云成功，才把本机 photos 换成服务器短地址
   ③ 全部处理完置 meta.photoBackedUp = true，之后 slimLocalPhotos() 才允许剥离

   任何一步失败都保持原样，绝不出现"本机删了、服务器又没有"的丢图情况。 */
async function migratePhotosToServer() {
  if (!Api.db || !Api.db.listings || !Api.db.listings.length) return;
  if (!Api.db.meta) Api.db.meta = {};
  if (Api.db.meta.photoMigrated) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const hasB64 = l => (l.photos || []).some(p => /^data:image\/(jpeg|jpg|png|webp)/i.test(p));
  const targets = Api.db.listings.filter(hasB64);
  if (!targets.length) {
    /* 没有本机 base64 照片，直接标记安全（此时剥离是空操作） */
    Api.db.meta.photoMigrated = true;
    Api.db.meta.photoBackedUp = true;
    Api.save();
    return;
  }

  if (typeof toast === 'function') toast('正在把照片搬到服务器，首次约需一会儿…');
  let doneCount = 0;
  for (const l of targets) {
    const cur = (l.photos || []).slice(0, 3);
    const out = [];
    let ok = true;
    for (let i = 0; i < cur.length; i++) {
      const p = cur[i];
      if (/^\/api\/photo\//.test(p)) { out.push(p); continue; }
      if (!/^data:image\//.test(p)) { out.push(p); continue; }
      try {
        const blob = await (await fetch(p)).blob();
        const r = await fetch('/api/photo/' + encodeURIComponent(l.id) + '/' + i + '?t=' + Date.now(), {
          method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob
        });
        const j = await r.json();
        if (j && j.url) { out.push(j.url); }
        else { ok = false; break; }
      } catch (e) { console.warn('照片上传失败', l.id, i, e); ok = false; break; }
    }
    /* 只有整组都成功了才替换，否则保持本机原图不动 */
    if (ok && out.length === cur.length) {
      l.photos = out;
      l.photosLoaded = false;
      doneCount++;
      try { if (Cloud.ready) await Cloud.pushRow('listings', l); } catch (e) { }
    }
  }

  Api.db.meta.photoMigrated = doneCount === targets.length;
  /* 全部房源都成功上云，才允许后续剥离本机副本 */
  if (Api.db.meta.photoMigrated) Api.db.meta.photoBackedUp = true;
  Api.save();
  if (doneCount) {
    if (typeof toast === 'function') toast('已把 ' + doneCount + ' 套房源的照片搬到服务器');
    /* 上云确认后立刻剥离本机 base64，把空间真正腾出来 */
    const n = Api.slimLocalPhotos(true);
    if (n && typeof toast === 'function') setTimeout(() => toast('已释放本机空间（' + n + ' 张照片转为在线加载）'), 1600);
  }
}

const TAG_META = { '特价': { cls: '' }, '热门': { cls: 'hot' }, '新上': { cls: 'new' } };

function listingCard(l) {
  const img = photoURL((l.photos && l.photos[0]) || photoURI('facade', 0));
  const tagCls = l.tag && TAG_META[l.tag] ? TAG_META[l.tag].cls : '';
  return `
  <button class="lcard" type="button" data-act="open:listing" data-id="${esc(l.id)}" aria-label="查看 ${esc(l.parkName)} ${esc(l.building)} 的房源详情">
    <div class="lcard-wrap">
      <div class="lcard-img media-frame">
        <img src="${esc(img)}" alt="${esc(l.parkName)}">
        <div class="lcard-badges">${l.tag && !['新上','上新'].includes(l.tag.trim()) ? `<span class="lcard-badge ${tagCls}">${esc(l.tag)}</span>` : ''}</div>
        ${l.status === 'offline' ? '<span class="badge-offline">已下架</span>' : ''}
      </div>
      <div class="lcard-main">
        <div class="lcard-title">${esc(publicListingTitle(l))}</div>
        ${l.listingCode?`<div class="listing-code">房源编号：<strong>${esc(l.listingCode)}</strong></div>`:''}
        <div class="lcard-sub">${esc(l.floor)} · ${l.area}㎡ · ${esc(l.orientation)}向</div>
        <div class="lcard-tags">
          <span class="tag blue">${esc(l.layout)}</span>
          <span class="tag">${esc(l.decoration)}</span>
        </div>
        <div class="lcard-price">
          <span class="price-num">${l.rent == null ? '面议' : l.rent}</span>
          <span class="price-unit">元/㎡·月</span>
          <span class="price-unit" style="margin-left:auto">${l.propertyFee == null ? '物业面议' : '物业 ' + l.propertyFee + ' 元'}</span>
        </div>
      </div>
    </div>
  </button>`;
}

function statusPill(s) {
  return s === 'online'
    ? '<span class="status-pill on">在租中</span>'
    : '<span class="status-pill off">已下架</span>';
}

/* ---------------- 首页 ---------------- */
function renderHome() {
  const online = onlineListings();
  const filtered = applyFilters(online, State.filters);
  const totalArea = online.reduce((s, l) => s + l.area, 0);
  const parkCount = new Set(online.map(l => l.region).filter(Boolean)).size;
  const unavailable = State.listingsLoading || State.listingsError;
  const f = State.filters;
  const selectedFilters = [['usage','房源类型'],['park','所属片区'],['area','可租面积'],['rent','租金单价'],['orientation','朝向'],['decoration','装修'],['layout','格局']].filter(([key])=>f[key]&&f[key]!=='全部');
  const activeCount=selectedFilters.length;

  return `
  <div class="home-hero">
    <div class="hero-inner">
    <div class="hero-intro">
      <span class="hero-eyebrow">东莞 · 松山湖 / 企业空间与产业资源</span>
      <h2>找到适合企业的<br>下一处空间</h2>
      <p>写字楼、厂房与研发空间，按面积、租金和交付条件筛选。</p>
    </div>
    <div class="hero-entries">
      <button type="button" class="hero-entry" data-act="entry:usage" data-v="写字楼">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a1 1 0 011-1h9a1 1 0 011 1v16"/><path d="M15 9h4a1 1 0 011 1v11"/><path d="M8 8h2M8 12h2M8 16h2M11.5 21v-3.5h2.5V21M2 21h20"/></svg>
        <b>写字楼</b><span> ${State.listingsLoading ? "正在读取…" : State.listingsError ? "暂未取得数据" : online.filter(l => (l.usage || '写字楼') === '写字楼').length + " 套在租"}</span>
      </button>
      <button type="button" class="hero-entry" data-act="entry:usage" data-v="厂房">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20"/><path d="M3 20V9l6 4V9l6 4V4h5v16"/><path d="M17 13h1M17 16h1M17 8h1"/></svg>
        <b>厂房</b><span> ${State.listingsLoading ? "正在读取…" : State.listingsError ? "暂未取得数据" : online.filter(l => l.usage === '厂房').length + " 套在租"}</span>
      </button>
      <button type="button" class="hero-entry" data-act="open:resources">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
        <b>产业资源</b><span> 企业 · 需求 · 服务</span>
      </button>
    </div>
    <div class="hero-sub">园区直租·免佣看房·工商注册·高新申报·股权融资·法律咨询</div>
    <div class="hero-stats">
      <div class="hero-stat"><b>${unavailable ? "—" : online.length}</b><span>在租房源</span></div>
      <div class="hero-stat"><b>${unavailable ? "—" : parkCount}</b><span>覆盖片区</span></div>
      <div class="hero-stat"><b>${unavailable ? "—" : (totalArea / 10000).toFixed(2)}</b><span>万㎡可租</span></div>
    </div>
    </div>
  </div>

  ${window.HomeSearch.markup(online)}

  <div class="filter-bar">
    <button class="filter-chip ${activeCount ? 'on' : ''}" type="button" data-act="open:filter">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 5h18M6 12h12M10 19h4" stroke-linecap="round"/></svg>
      筛选${activeCount ? '(' + activeCount + ')' : ''}
    </button>
    ${SORT_OPTS.filter(s => s.k === 'rent-asc' || s.k === 'area-desc' || s.k === 'new').map(s => `
      <button class="filter-chip ${f.sort === s.k ? 'on' : ''}" type="button" data-act="set:sort" data-v="${s.k}">${s.t}</button>`).join('')}
  </div>

  ${(activeCount||f.kw) ? `<div class="active-filters" aria-label="已应用的筛选条件"><span>已选</span>${selectedFilters.map(([key,label])=>`<button type="button" data-act="filters:remove" data-v="${key}" aria-label="清除${label}条件">${esc(label)}：${esc(['area','rent'].includes(key)?rangeLabel(f[key],key):f[key])}<span aria-hidden="true">×</span></button>`).join('')}${f.kw?`<button type="button" data-act="filters:remove" data-v="kw" aria-label="清除搜索条件">搜索：${esc(f.kw)}<span aria-hidden="true">×</span></button>`:''}<button class="active-filters-reset" type="button" data-act="filters:reset">清除条件</button></div>` : ''}

  <div class="sec-title">
    <h2>${f.usage !== '全部' ? esc(f.usage) + '房源' : '精选房源'}</h2>
    <span class="sec-more">${State.listingsLoading ? "正在读取…" : State.listingsError ? "暂未取得数据" : "共 " + filtered.length + " 套"} · <span data-act="open:filter" style="color:var(--primary)">排序筛选</span></span>
  </div>
  <div class="listing-list">
    ${filtered.length ? filtered.map(listingCard).join('') : State.listingsLoading ? `<span class="sr-only" role="status">正在读取已发布房源…</span>${Array.from({length:3},()=>'<div class="listing-skeleton" aria-hidden="true"><div class="skeleton-photo"></div><div class="skeleton-lines"><div class="skeleton-line"></div><div class="skeleton-line short"></div><div class="skeleton-line price"></div></div></div>').join('')}` : State.listingsError ? `<div class="empty" role="status">${esc(State.listingsErrorMessage || "房源暂时加载失败，请检查网络后重试。")}<br><small>${esc(State.listingsErrorCode || "")}</small><br><button type="button" class="result-reset" data-act="catalog:retry">重新加载</button></div>` : `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="#B9C2CF" stroke-width="1.5"><path d="M3 10l9-7 9 7v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M9 21V12h6v9"/></svg>
        没有符合条件的房源<br>试试放宽筛选条件<br>
        <button class="result-reset" type="button" data-act="filters:reset">清除全部筛选</button>
      </div>`}
  </div>
  <footer class="site-footer">${State.listingsLoading ? "正在读取房源资料…" : State.listingsError ? "房源资料暂未取得" : "已展示 " + filtered.length + " 条结果"} · 房源资料由发布方维护<br>松山湖产业招商 · 登来</footer>`;
}

/* ---------------- 地图找房 ---------------- */
/* 标签防重叠：按纵坐标排序后贪心挑选偏移量（候选顺序 = 优先下方，其次上方，再左右） */
const LABEL_CAND = [[0, .95], [0, -12.2], [0, 6.8], [-19, .95], [19, .95],
[-19, -12.2], [19, -12.2], [0, -18], [0, 12.6], [-19, 6.8], [19, 6.8]];

function layoutMarkers(groups) {
  const boxes = [];
  groups.slice().sort((a, b) => a.c.y - b.c.y || a.c.x - b.c.x).forEach(g => {
    const w = Math.min(30, g.park.name.replace('松山湖', '').length * 2.5 + 5.5);
    const h = 5.4;
    let pick = LABEL_CAND[0];
    for (let i = 0; i < LABEL_CAND.length; i++) {
      const c = LABEL_CAND[i];
      const x0 = g.c.x + c[0] - w / 2, x1 = g.c.x + c[0] + w / 2;
      const y0 = g.c.y + c[1], y1 = y0 + h;
      if (!boxes.some(b => !(x1 < b.x0 || x0 > b.x1 || y1 < b.y0 || y0 > b.y1))) { pick = c; break; }
    }
    const lx = g.c.x + pick[0], ly = g.c.y + pick[1];
    boxes.push({ x0: lx - w / 2, x1: lx + w / 2, y0: ly, y1: ly + h });
    g.label = { x: lx, y: ly };
  });
  return groups;
}

function applyMapTransform() {
  const inner = $('#mapInner');
  if (inner) inner.style.transform = `translate(${State.mapX}px,${State.mapY}px) scale(${State.mapScale})`;
}

/* 把某个园区移到地图中央并放大 */
function centerOnPark(name, scale) {
  const c = Api.parkCoord(name);
  const stage = $('#mapStage');
  const S = stage ? stage.offsetWidth : 0;
  State.mapScale = scale || 1.9;
  if (S) {
    State.mapX = S / 2 - State.mapScale * c.x / 100 * S;
    State.mapY = S / 2 - State.mapScale * c.y / 100 * S;
  }
  applyMapTransform();
}

/* ---------------- 在线地图（腾讯位置服务 GL JS · 合规底图） ----------------
   合规说明：底图使用腾讯位置服务（GCJ-02），不使用境外地图源。
   Key 由管理员在「管理后台 → 登录验证与分享」填入（https://lbs.qq.com 免费申请，并把本站域名
   加入该 Key 的「WebServiceAPI/JS API 域名白名单」）；前端代码内不预置任何 Key。
   未配置 Key 或加载失败时，自动回退到内置静态底图，功能不受影响。 */
const MapKit = {
  T: null, loading: null,
  key() { return String((Api.db.settings && Api.db.settings.tmapKey) || '').trim(); },
  has() { return !!this.key(); },
  load() { return Promise.resolve(false); },
  /* 默认中心点：全部园区经纬度的平均值（松山湖片区） */
  center() {
    const ps = parksAll().filter(p => p.lat && p.lon);
    if (!ps.length) return { lat: 22.9165, lng: 113.8884 };
    return {
      lat: ps.reduce((s, p) => s + p.lat, 0) / ps.length,
      lng: ps.reduce((s, p) => s + p.lon, 0) / ps.length
    };
  },
  ll(lat, lng) { return new this.T.LatLng(lat, lng); }
};

/* 地图页分组的园区标记（含经纬度） */
function mapGroups() {
  const online = onlineListings();
  return parksAll().map(p => {
    const all = Api.db.listings.filter(l => l.parkName === p.name);
    return {
      park: p, list: online.filter(l => l.parkName === p.name), total: all.length,
      c: Api.parkCoord(p.name)
    };
  }).filter(g => g.total > 0);
}

function renderMap() {
  return '';
}

/* ---------------- 房源详情 ---------------- */
/* 详情页照片大图在云端 listings.full 列，列表拉取不带；进入详情时单条补拉 */
function ensureListingPhotos(id) {
  return new Promise(resolve => {
    if (!Cloud.ready || !Cloud.client) return resolve(false);
    const cur = findListing(id);
    if (cur && cur.photosLoaded) return resolve(true);
    let done = false;
    const fin = v => { if (!done) { done = true; resolve(v); } };
    Cloud.client.database.from('listings').select('data,full').eq('id', id).maybeSingle()
      .then(res => {
        if (res && !res.error && res.data) {
          const l = findListing(id);
          const full = (res.data.full && res.data.full.photos) || [];
          const inRow = (res.data.data && res.data.data.photos) || [];
          const photos = full.length >= inRow.length ? full : inRow;
          if (l) {
            /* 只补更长的一组，不缩短已在本地的大图 */
            if (photos.length > (l.photos || []).length) l.photos = photos;
            l.photosLoaded = true;
            Api.save();
          }
        }
        fin(true);
      })
      .catch(() => fin(false));
    /* 弱网兜底：最多等 8 秒，避免编辑表单迟迟打不开 */
    setTimeout(() => fin(false), 8000);
  });
}

function loadListingPhotos(id) {
  ensureListingPhotos(id).then(() => {
    if (State.view === 'detail' && State.params.id === id) render();
  });
}

function publicListingTitle(l) {
  return l.title || [l.parkName,l.building,l.floor].filter(Boolean).join(' · ') || '房源详情';
}

function renderDetail() {
  const l = findListing(State.params.id);
  if (!l && State.listingsLoading) return '<div class="empty" role="status"><div class="spinner" style="margin:40px auto 16px"></div>正在读取房源详情…</div>';
  if (!l && State.listingsError) return '<div class="empty">暂时无法读取房源，请检查网络后重试。<br><button type="button" class="result-reset" data-act="detail:retry">重新加载</button></div>';
  if (!l && State.deepPending && Cloud.ready) {
    /* 深链房源本地暂无：云端拉取失败时给出重试入口，成功但无此房才判"不存在" */
    if (Cloud.lastPullOk === false) {
      return `
  <div class="empty" style="padding-top:88px;text-align:center">
    <div style="font-size:44px;margin-bottom:10px">📡</div>
    <p style="font-size:15px;font-weight:600;color:var(--text-1)">云端连接失败，无法确认该房源</p>
    <p style="font-size:12.5px;color:var(--text-3);margin-top:6px">请检查网络后重试</p>
    <button class="btn" style="margin-top:18px;width:auto;padding:0 34px" type="button" data-act="detail:retry">重试</button>
  </div>`;
    }
    return `
  <div class="empty" style="padding-top:96px;text-align:center">
    <div class="spinner" style="margin:0 auto 14px"></div>
    <p style="font-size:14.5px;font-weight:600;color:var(--text-1)">正在从云端加载房源…</p>
    <p style="font-size:12.5px;color:var(--text-3);margin-top:6px">网络较慢时会多等几秒</p>
  </div>`;
  }
  if (!l) return `
  <div class="empty" style="padding-top:64px;text-align:center">
    <div style="font-size:44px;margin-bottom:10px">🏢</div>
    <p style="font-size:16px;font-weight:600;color:var(--text-1)">房源不存在或已被删除</p>
    <p style="font-size:12.5px;color:var(--text-3);line-height:1.8;padding:0 30px;margin-top:6px">
      已确认云端没有编号「${esc(String(State.params.id || ''))}」的房源，可能已被下架删除。
    </p>
    <button class="btn" style="margin-top:18px;width:auto;padding:0 34px" type="button" data-act="tab" data-v="home">返回首页看在租房源</button>
    <button class="btn ghost" style="margin-top:10px;width:auto;padding:8px 22px;font-size:13px" type="button" data-act="detail:retry">刷新重试</button>
  </div>`;
  if (!l.photosLoaded) loadListingPhotos(l.id);
  const photos = l.photos && l.photos.length ? l.photos : [photoURI('facade', 0)];
  const monthlyCosts = window.SiteFees.calculate(l.area, l.rent, l.propertyFee);
  const monthlyAmount = cents => cents === null ? '待确认' : '¥' + window.SiteFees.formatCents(cents);
  return `
  <div class="detail-layout">
<div class="detail-media"><div class="detail-photo-layout ${photos.length > 1 ? 'has-previews' : ''}">
  <div class="gallery">
    <div class="gallery-track" id="galleryTrack">
      ${photos.map((p,i) => `<button class="gallery-photo media-frame" type="button" data-act="gallery:expand" data-v="${i}" aria-label="放大第 ${i+1} 张房源照片"><img src="${esc(photoURL(p))}" alt="${esc(l.parkName)}实拍图" draggable="false"></button>`).join('')}
    </div>
    <div class="gallery-dots" id="galleryDots">
      ${photos.map((_, i) => `<button type="button" class="gdot ${i === 0 ? 'on' : ''}" data-act="gallery:go" data-v="${i}" aria-label="查看第 ${i+1} 张照片"></button>`).join('')}
    </div>
    <div class="gallery-count" aria-live="polite">1/${photos.length}</div><span class="gallery-expand-hint">点击查看大图</span>
    ${photos.length > 1 ? '<button class="gallery-step prev" type="button" data-act="gallery:prev" aria-label="上一张照片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></button><button class="gallery-step next" type="button" data-act="gallery:next" aria-label="下一张照片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>' : ''}
    ${l.status === 'offline' ? '<div style="position:absolute;left:0;top:0;background:rgba(60,66,78,.86);color:#fff;font-size:12px;padding:5px 12px;border-radius:0 0 10px 0">该房源已下架</div>' : ''}
  </div>
  ${photos.length > 1 ? `<div class="detail-thumbnails ${photos.length === 2 ? 'single' : ''}" aria-label="后续房源照片预览">${(photos.length === 2 ? [1] : [1,2]).map((offset,row)=>`<div class="detail-preview"><div class="detail-preview-track" data-offset="${offset}" role="group" aria-label="右侧${row===0?'上方':'下方'}照片预览，可左右滑动切换相册" tabindex="0">${photos.map((p,i)=>`<button type="button" data-act="gallery:expand" data-v="${i}" aria-label="放大第 ${i+1} 张房源照片"><img src="${esc(photoURL(p))}" alt="${esc(l.parkName)}实拍图" loading="lazy" draggable="false"></button>`).join('')}</div></div>`).join('')}</div>` : ''}

</div>
  ${photos.length > 1 ? '<p class="gallery-controls-hint">点击左右箭头查看全部照片，也可以横向滑动</p>' : ''}
</div>
  <div class="detail-head">
    <div class="detail-price">
      <span class="num">${l.rent == null ? '面议' : l.rent}</span><span class="unit">元/㎡·月</span>
      <span class="fee">${l.propertyFee == null ? '物业费待咨询' : '物业费 ' + l.propertyFee + ' 元/㎡·月'}</span>
    </div>
    <h2 class="detail-title">${esc(publicListingTitle(l))}</h2>
    ${l.listingCode?`<p class="listing-code detail-code">房源编号：<strong>${esc(l.listingCode)}</strong><span>电话咨询时可报此编号</span></p>`:''}
    <div class="detail-tags">
      ${l.tag && !['新上','上新'].includes(l.tag.trim()) ? `<span class="tag ${l.tag === '热门' ? 'orange' : (l.tag === '特价' ? 'red' : 'green')}">${esc(l.tag)}</span>` : ''}
      <span class="tag blue">${esc(l.layout)}</span>
      <span class="tag">${esc(l.usage || '写字楼')}</span>
      <span class="tag">${esc(l.decoration)}</span>
      <span class="tag">${esc(l.orientation)}向</span>
      <span class="tag green">${l.area}㎡</span>
      ${monthlyCosts.rentCents === null ? '' : `<span class="tag orange">月租金 ¥${window.SiteFees.formatCents(monthlyCosts.rentCents)}</span>`}
    </div>
  </div>

  <div class="info-grid">
    <h3>房源参数</h3>
    <div class="info-rows">
      ${l.parkName?`<div class="info-item"><span class="info-k">片区</span><span class="info-v">${esc(l.parkName)}</span></div>`:''}
      ${l.building?`<div class="info-item"><span class="info-k">${l.legacyUnit?'楼栋／房号':'楼栋'}</span><span class="info-v">${esc(l.building)}</span></div>`:''}
      ${l.room?`<div class="info-item"><span class="info-k">房号</span><span class="info-v">${esc(l.room)}</span></div>`:''}
      ${l.floor?`<div class="info-item"><span class="info-k">楼层</span><span class="info-v">${esc(l.floor)}</span></div>`:''}
      <div class="info-item"><span class="info-k">面积</span><span class="info-v">${l.area} ㎡</span></div>
      <div class="info-item"><span class="info-k">朝向</span><span class="info-v">${esc(l.orientation)}</span></div>
      <div class="info-item"><span class="info-k">装修</span><span class="info-v">${esc(l.decoration)}</span></div>
      <div class="info-item"><span class="info-k">格局</span><span class="info-v">${esc(l.layout)}</span></div>
      <div class="info-item"><span class="info-k">租金</span><span class="info-v" style="color:var(--price)">${l.rent == null ? '面议' : l.rent + ' 元/㎡·月'}</span></div>
      <div class="info-item"><span class="info-k">物业费</span><span class="info-v">${l.propertyFee == null ? '面议' : l.propertyFee + ' 元/㎡·月'}</span></div>
      ${[['支付方式',l.paymentTerms],['免租期',l.freeRentPeriod],['中介费',typeof l.agentFee==='boolean'?(l.agentFee?'有':'无'):null],...(['厂房','仓储'].includes(l.usage)?l.industrialFields||[]:[])].filter(([,value])=>value!=null&&value!=='').map(([label,value])=>`<div class="info-item"><span class="info-k">${esc(label)}</span><span class="info-v">${esc(value)}</span></div>`).join('')}
      <div class="info-item"><span class="info-k">浏览量</span><span class="info-v">${l.views} 次</span></div>
      <div class="info-item full"><span class="info-k">挂牌时间</span><span class="info-v">${fmtDate(new Date(l.createdAt))}</span></div>
    </div>
  </div>

  <section id="detail-contact-body" class="detail-contact-body" aria-labelledby="detail-contact-title">
  <h3 id="detail-contact-title">招商联系</h3>
  <div class="detail-contact">
    <div class="contact-avatar">${esc(l.contact.slice(0, 1))}</div>
    <div style="flex:1;min-width:0">
      <div class="contact-name">${esc(l.contact)}</div>
      <div class="contact-role">园区招商 · ${esc(maskPhone(l.phone))}</div>
    </div>
    <button class="btn sm" type="button" data-act="${l.phone ? 'call' : 'open:inquiry'}" data-id="${l.id}" data-v="${esc(l.phone)}">${l.phone ? '拨打电话' : '留言联系'}</button>
  </div>
  ${l.wechat||l.videoChannel?`<div class="detail-contact-channels">${l.wechat?`<div><span>微信</span><strong>${esc(l.wechat)}</strong></div>`:''}${l.videoChannel?`<div><span>视频号</span><strong>${esc(l.videoChannel)}</strong></div>`:''}</div>`:''}
  </section>

  <div class="detail-desc">
    <h3>房源介绍</h3>
    ${l.facilities?`<h4>园区配套</h4><p>${esc(l.facilities)}</p>`:''}
    <p>${esc(l.desc || '暂无房源介绍，如需了解更多详情请留言咨询或电话联系招商顾问。')}</p>
  </div>

  <div class="park-card">
    <h3 style="font-size:14px;font-weight:700;display:flex;align-items:center;gap:6px">
      <span style="width:3px;height:13px;background:var(--primary);border-radius:2px;display:inline-block"></span>所属片区
    </h3>
    <div class="park-row">
      <div class="park-ico">${esc((l.parkName||'园').slice(0, 1))}</div>
      <div style="flex:1;min-width:0">
        <div class="park-name">${esc(l.parkName||'片区待确认')}</div>
      </div>
    </div>
    ${window.SiteAreaLocation?.markup(l) || ''}
  </div>



  ${(l.videos || []).length ? `<section class="detail-videos"><h3>房源视频</h3><div class="video-list">${l.videos.map(url => `<video src="${esc(url)}" controls playsinline preload="metadata" aria-label="房源实拍视频"></video>`).join('')}</div></section>` : ''}
  <aside class="detail-sidebar ${State.costDetailsId===l.id?'is-expanded':''}" aria-label="费用与招商咨询">
  <button class="costs-toggle" type="button" data-act="detail:costs" data-id="${esc(l.id)}" aria-expanded="${State.costDetailsId===l.id}" aria-controls="monthly-costs-body">
    <span class="costs-toggle-label">每月合计<small>租金 + 物业费</small></span><strong>${monthlyAmount(monthlyCosts.totalCents)}</strong>
    <span class="costs-toggle-action"><span>${State.costDetailsId===l.id?'收起明细':'查看明细'}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
  </button>
  <section class="monthly-costs" aria-labelledby="monthly-costs-title">
    <h3 id="monthly-costs-title">每月费用明细</h3>
    <div id="monthly-costs-body" class="monthly-costs-body">
    <dl>
      <div><dt>月租金 <small>${l.rent == null || !(Number(l.area)>0) ? '面积或租金单价待确认' : esc(l.area)+'㎡ × '+esc(l.rent)+'元/㎡·月'}</small></dt><dd>${monthlyAmount(monthlyCosts.rentCents)}</dd></div>
      <div><dt>月物业费 <small>${l.propertyFee == null || !(Number(l.area)>0) ? '面积或物业单价待确认' : esc(l.area)+'㎡ × '+esc(l.propertyFee)+'元/㎡·月'}</small></dt><dd>${monthlyAmount(monthlyCosts.feeCents)}</dd></div>
      <div class="monthly-costs-total"><dt>每月合计 <small>月租金 + 月物业费</small></dt><dd>${monthlyAmount(monthlyCosts.totalCents)}</dd></div>
    </dl>
    <p>按各项金额四舍五入到分后相加。合计仅含租金与物业费；未填写的费用需咨询确认。</p>
    </div>
  </section>

  <div class="detail-actions">
    <button class="da-btn" type="button" data-act="${l.phone ? 'call' : 'open:inquiry'}" data-id="${esc(l.id)}" data-v="${esc(l.phone)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M5 3h3.6l1.8 4.5-2.2 1.6a12 12 0 006.7 6.7l1.6-2.2L21 15.4V19a2 2 0 01-2.2 2A16.8 16.8 0 013 5.2 2 2 0 015 3z" stroke-linejoin="round"/></svg>
      ${l.phone ? '电话' : '联系顾问'}
    </button>
    <button class="da-btn" type="button" data-act="open:inquiry" data-id="${l.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 5h16v11H9l-5 4z" stroke-linejoin="round"/></svg>
      留言
    </button>
    <button class="da-btn" type="button" data-act="open:share" data-id="${l.id}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.3 10.8 15.7 6.4M8.3 13.2l7.4 4.4"/></svg>
      分享房源
    </button>
    <button class="btn block" type="button" data-act="open:inquiry" data-id="${l.id}" data-type="预约看房">
      预约看房 / 咨询底价
    </button>
  </div>


  </aside>
  </div>`;
}
function renderMessage() {
  const v = State.session.visitor;
  if (!v) {
    return `<div class="empty" style="padding-top:80px">
      <svg viewBox="0 0 24 24" fill="none" stroke="#B9C2CF" stroke-width="1.5"><path d="M4 5h16v11H9l-5 4z" stroke-linejoin="round"/></svg>
      <div style="margin-bottom:16px">填写访客资料后可查看本机咨询记录</div>
      <button class="btn" style="width:200px;margin:0 auto" type="button" data-act="open:login">填写资料</button>
    </div>`;
  }
  const list = Api.db.messages.filter(m => m.visitorId === v.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const pending = list.filter(m => m.status === 'pending').length;
  return `
  <div class="pad" style="padding-top:14px">
    <div class="card" style="padding:13px;display:flex;align-items:center;gap:12px">
      <div class="contact-avatar" style="background:linear-gradient(135deg,#4FA4FF,#1677FF)">${esc(v.nick.slice(0, 1))}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14.5px;font-weight:600">${esc(v.nick)}，你好</div>
        <div style="font-size:11.5px;color:var(--text-3);margin-top:3px">共 ${list.length} 条咨询 · ${pending} 条待回复</div>
      </div>
    </div>
  </div>
  ${window.SiteMessageActions?.redoHTML() || ''}
  ${list.length ? list.map(m => {
    const l = findListing(m.listingId);
    return `
    <div class="msg-item" data-message-id="${esc(m.id)}">
      <div class="msg-top">
        <div class="msg-listing" ${l ? `data-act="open:listing" data-id="${m.listingId}"` : ''}>${l ? esc(publicListingTitle(l)) : m.kind === 'company' ? '企业资料登记' : m.kind === 'need' ? '选址需求登记' : '一般咨询／房源已下架'}</div>
        <span class="msg-status ${m.status === 'pending' ? 'pending' : 'done'}">${m.status === 'pending' ? '待回复' : m.status === 'closed' ? '已完成' : '已回复'}</span>
      </div>
      <div class="msg-body">【${esc(m.type)}】${esc(m.content)}</div>
      ${m.reply ? `<div class="msg-reply"><b>招商顾问回复：</b>${esc(m.reply)}</div>` : ''}
      <div class="msg-meta"><span>${esc(m.createdAt)}</span><span>联系方式 ${esc(maskPhone(m.phone))}</span></div>
      ${window.SiteMessageActions?.buttonHTML(m) || ''}
    </div>`;
  }).join('') : '<div class="empty">还没有咨询记录，去房源列表看看吧</div>'}
  <div style="height:8px"></div>`;
}

/* ---------------- 我的 ---------------- */
function renderMine() {
  const v = curVisitor();
  const adm = State.session.admin;
  const myMsgs = v ? Api.db.messages.filter(m => m.visitorId === v.id) : [];
  const viewed = (State.session.viewed || []).length;
  return `
  <div class="mine-head">
    <div class="mine-user">
      <button class="mine-avatar" type="button" data-act="open:login" aria-label="编辑头像和客户资料">${window.SiteCustomer.avatarHTML(v?.avatar,v?.nick)}</button>
      <div style="flex:1;min-width:0">
        <div class="mine-name">${v ? esc(v.nick) : '尚未填写资料'}</div>
        <div class="mine-sub">${v ? esc(maskPhone(v.phone)) : '填写资料后可管理本机咨询记录'}</div>
        ${v?.customerCode ? `<div class="mine-sub">客户编号：${esc(v.customerCode)}</div>` : ''}
      </div>
      <button class="btn sm" style="background:#fff;color:var(--primary)" type="button" data-act="open:login">${v?'编辑资料':'填写资料'}</button>
    </div>
  </div>

  <div class="mine-grid">
    <div><b>${myMsgs.length}</b><span>我的咨询</span></div>
    <div><b>${myMsgs.filter(m => m.status === 'replied' || m.status === 'done').length}</b><span>已回复</span></div>
    <div><b>${viewed}</b><span>浏览记录</span></div>
  </div>

  <div class="menu-list">
    <div class="menu-item" data-act="open:myCompany">
      <div class="menu-ico">🏢</div><div class="mi-text">我的企业</div>
      <div class="mi-val">${v ? ((v.company && v.company.name) ? esc(v.company.name) : '去完善') : '填写后使用'}</div><div class="mi-arrow">›</div>
    </div>
    <div class="menu-item" data-act="open:myNeeds">
      <div class="menu-ico">📋</div><div class="mi-text">我的需求</div>
      <div class="mi-val">${v ? ((v.needs && v.needs.length) ? v.needs.length + ' 项' : '去填写') : '填写后使用'}</div><div class="mi-arrow">›</div>
    </div>
    <div class="menu-item" data-act="tab" data-v="message">
      <div class="menu-ico">💬</div><div class="mi-text">我的留言咨询</div>
      <div class="mi-val">${myMsgs.filter(m => m.status === 'pending').length} 条待回复</div>
      <div class="mi-arrow">›</div>
    </div>
    <div class="menu-item" data-act="open:viewed">
      <div class="menu-ico">👁</div><div class="mi-text">浏览记录</div>
      <div class="mi-val">${viewed} 条</div><div class="mi-arrow">›</div>
    </div>
    <div class="menu-item" data-act="call" data-v="${esc(Api.db.settings.hotline)}">
      <div class="menu-ico">📞</div><div class="mi-text">招商热线</div>
      <div class="mi-val">${esc(Api.db.settings.hotline)}</div><div class="mi-arrow">›</div>
    </div>
    <div class="menu-item" data-act="open:about">
      <div class="menu-ico">ℹ️</div><div class="mi-text">关于平台</div><div class="mi-arrow">›</div>
    </div>
  </div>

  <div class="menu-list">
    <button class="menu-item" type="button" data-act="open:settings" style="width:100%;border:0;background:transparent;text-align:left;font:inherit;color:inherit">
      <div class="menu-ico">⚙️</div>
      <div class="mi-text">设置</div><div class="mi-arrow">›</div>
    </button>
    ${v ? `<div class="menu-item" data-act="visitor:logout">
        <div class="menu-ico" style="background:#EEF1F6;color:var(--text-3)">⎋</div>
        <div class="mi-text">清除本机资料</div><div class="mi-arrow">›</div>
      </div>` : ''}
  </div>
  <div style="text-align:center;font-size:11px;color:var(--text-3);padding:18px 0 6px;line-height:1.7">
    松山湖产业招商网站<br>房源、咨询及已提交的企业／需求资料保存在云端<br>本机保留查询回执，用于查看回复
  </div>`;
}

/* ---------------- 产业资源 ---------------- */
const INDRES_TYPES = ['政策资金', '产业载体', '投融资对接', '人才服务', '供应链资源', '其他'];

function renderResources() {
  const admin = State.session.admin;
  const resources = Api.db.settings.indRes || [];
  const visitor = curVisitor();
  const company = visitor?.company;
  const needs = visitor?.needs || [];
  const types = [...new Set(resources.map(resource => resource.type || '其他'))];

  return `
  <div class="industry-page">
    <section class="industry-match" aria-labelledby="industry-match-title">
      <div>
        <h2 id="industry-match-title">AI匹配上下游</h2>
        <p>描述你提供的产品或服务，以及想找的供应商、客户或合作方。</p>
      </div>
      <form class="industry-composer">
        <label class="sr-only" for="industry-match-query">上下游匹配需求</label>
        <textarea id="industry-match-query" rows="2" maxlength="300" placeholder="例如：我们做精密注塑，想找松山湖附近的模具供应商" required></textarea>
        <div class="industry-composer-actions">
          <span role="status">入口预览，AI匹配待开放</span>
          <button type="submit">开始匹配</button>
        </div>
      </form>
    </section>

    <div class="industry-personal">
      <section class="industry-panel" aria-labelledby="industry-company-title">
        <div>
          <h2 id="industry-company-title">我的企业</h2>
          <p>${company?.name ? esc(company.name) : '登记企业与主营产品，方便后续对接。'}</p>
        </div>
        <button type="button" data-act="open:myCompany">${company?.name ? '查看或编辑' : '完善企业资料'} <span aria-hidden="true">›</span></button>
      </section>
      <section class="industry-panel" aria-labelledby="industry-needs-title">
        <div>
          <h2 id="industry-needs-title">我的需求</h2>
          <p>${needs.length ? '已登记 ' + needs.length + ' 条需求' : '登记采购、合作或其他企业需求。'}</p>
        </div>
        <button type="button" data-act="open:myNeeds">${needs.length ? '查看或新增' : '登记需求'} <span aria-hidden="true">›</span></button>
      </section>
    </div>

    <section class="industry-catalog" aria-labelledby="industry-catalog-title">
      <div class="industry-catalog-head">
        <h2 id="industry-catalog-title">产业资源</h2>
        ${admin ? '<button class="btn sm" type="button" data-act="open:indResForm">＋ 录入资源</button>' : ''}
      </div>
      <div class="industry-toolbar">
        <label class="sr-only" for="industry-resource-type">资源类型</label>
        <select id="industry-resource-type">
          <option value="">全部类型</option>
          ${types.map(type => `<option value="${esc(type)}">${esc(type)}</option>`).join('')}
        </select>
        <span class="industry-count" role="status">共 ${resources.length} 条</span>
      </div>
      <p class="industry-empty" ${resources.length ? 'hidden' : ''}>暂无已发布的产业资源</p>
      <div class="industry-grid">
        ${resources.map(resource => `
          <article class="industry-resource" data-resource-type="${esc(resource.type || '其他')}">
            <details>
              <summary>
                <span class="industry-type">${esc(resource.type || '其他')}</span>
                <h3>${esc(resource.title)}</h3>
                <span class="industry-detail-label" aria-hidden="true"></span>
              </summary>
              <div class="industry-resource-details">
                <p>${esc(resource.desc || '暂无详细说明')}</p>
                ${resource.contact ? `<p class="industry-contact">联系方式 ${esc(resource.contact)}</p>` : ''}
              </div>
            </details>
            ${admin ? `<button class="btn sm ghost industry-delete" type="button" data-act="del:indRes" data-id="${esc(resource.id)}">删除</button>` : ''}
          </article>`).join('')}
      </div>
    </section>
  </div>`;
}

function bindResources(view) {
  const form = view.querySelector('.industry-composer');
  form.addEventListener('submit', event => {
    event.preventDefault();
    form.querySelector('[role="status"]').textContent = '已体验入口，AI匹配尚未开放。';
  });

  const filter = view.querySelector('#industry-resource-type');
  const cards = [...view.querySelectorAll('.industry-resource')];
  filter.addEventListener('change', () => {
    const selected = filter.value;
    let count = 0;
    for (const card of cards) {
      card.hidden = Boolean(selected && card.dataset.resourceType !== selected);
      if (!card.hidden) count++;
    }
    view.querySelector('.industry-count').textContent = `共 ${count} 条`;
    const empty = view.querySelector('.industry-empty');
    empty.hidden = count > 0;
    empty.textContent = selected ? '当前类型暂无已发布的资源' : '暂无已发布的产业资源';
  });
}

function sheetIndRes() {
  if (!State.session.admin) return toast('请先登录管理员');
  openSheet(`
    <div class="sheet-head">
      <h3>录入产业资源</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field"><label>资源类型<span class="req">*</span></label>
        <select id="irType">${INDRES_TYPES.map(o => `<option>${o}</option>`).join('')}</select></div>
      <div class="field"><label>资源名称<span class="req">*</span></label>
        <input type="text" id="irTitle" maxlength="40" placeholder="如：松山湖专精特新申报辅导"></div>
      <div class="field"><label>资源说明</label>
        <textarea id="irDesc" maxlength="300" placeholder="简要说明服务内容、申报条件、对接方式等">${''}</textarea></div>
      <div class="field"><label>联系方式</label>
        <input type="text" id="irContact" maxlength="30" value="${esc(Api.db.settings.hotline || '')}" placeholder="电话 / 微信"></div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="submit:indRes">保存</button>
    </div>`);
}

function submitIndRes() {
  if (!State.session.admin) return toast('请先登录管理员');
  const title = (($('#irTitle') || {}).value || '').trim();
  if (!title) return toast('请填写资源名称');
  const st = Api.db.settings;
  st.indRes = (st.indRes || []).concat([{
    id: uid('R'),
    type: (($('#irType') || {}).value || '其他').trim(),
    title,
    desc: (($('#irDesc') || {}).value || '').trim(),
    contact: (($('#irContact') || {}).value || '').trim(),
    at: fmtDateTime(new Date())
  }]);
  Api.save();
  Cloud.markDirtyKeys(['indRes']);
  Cloud.pushMeta();
  closeSheet();
  toast('产业资源已录入');
  render();
}

function delIndRes(id) {
  if (!State.session.admin) return toast('请先登录管理员');
  const st = Api.db.settings;
  st.indRes = (st.indRes || []).filter(r => r.id !== id);
  Api.save();
  Cloud.markDirtyKeys(['indRes']);
  Cloud.pushMeta();
  toast('已删除');
  render();
}

/* ---------------- 管理后台 ---------------- */
function renderAdmin() {
  const adm = State.session.admin;
  if (!adm) return adminLoginInline();
  const tabs = [
    { k: 'listing', t: '房源' },
    { k: 'message', t: '留言' },
    { k: 'dashboard', t: '数据' },
    { k: 'map', t: '地图标注' },
    { k: 'parks', t: '园区' },
    { k: 'system', t: '设置' }
  ];
  const pending = Api.db.messages.filter(m => m.status === 'pending').length;
  return `
  <div class="admin-head">
    <div style="display:flex;align-items:center;gap:12px">
      <div class="admin-avatar ${adm.role === 'super' ? 'super' : ''}" style="width:46px;height:46px;font-size:18px">${esc(adm.name.slice(0, 1))}</div>
      <div style="flex:1;min-width:0">
        <div class="ah-name">${esc(adm.name)}</div>
        <div class="ah-role">${adm.role === 'super' ? '超级管理员 · 全部权限' : '普通管理员 · 房源与留言'}</div>
      </div>
    </div>
    <div style="display:flex;gap:22px;margin-top:14px">
      <div class="hero-stat"><b>${Api.db.listings.filter(l => l.status === 'online').length}</b><span>在租房源</span></div>
      <div class="hero-stat"><b>${pending}</b><span>待处理留言</span></div>
      <div class="hero-stat"><b>${Api.db.stats.visitors}</b><span>累计访客</span></div>
    </div>
  </div>
  <div class="admin-tabs">
    ${tabs.map(t => `<button type="button" class="${State.adminTab === t.k ? 'on' : ''}" data-act="admin:tab" data-v="${t.k}">${t.t}${t.k === 'message' && pending ? ' ·' + pending : ''}</button>`).join('')}
  </div>
  <div id="adminBody">${State.adminTab === 'listing' ? adminListingBody()
      : State.adminTab === 'message' ? adminMessageBody()
        : State.adminTab === 'dashboard' ? adminDashboardBody()
          : State.adminTab === 'map' ? adminMapBody()
            : State.adminTab === 'parks' ? adminParksBody()
              : adminSystemBody()}</div>`;
}

function adminLoginInline() {
  return `
  <div class="pad" style="padding-top:20px">
    <div class="card" style="padding:18px 16px 20px">
      <div style="text-align:center;margin-bottom:14px">
        <div class="park-ico" style="margin:0 auto 10px;width:46px;height:46px;font-size:19px;border-radius:14px">管</div>
        <div style="font-size:16px;font-weight:700">管理员登录</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:5px">登录后可新增 / 上下架房源、处理留言与查看数据</div>
      </div>
      <div class="field"><label>账号</label><input type="text" id="admUser" placeholder="请输入管理员账号" autocomplete="username"></div>
      <div class="field"><label>密码</label><input type="password" id="admPwd" placeholder="请输入登录密码" autocomplete="current-password"></div>
      <button class="btn" style="margin-top:16px" type="button" data-act="admin:login">登录管理后台</button>
      <div style="font-size:11.5px;color:var(--text-3);text-align:center;margin-top:12px;line-height:1.7">
        需输入完整账号和密码才能登录，账号密码由超级管理员在后台创建与分配
      </div>
    </div>
  </div>`;
}

function adminListingBody() {
  const f = State.adminListFilter;
  const kw = State.adminKw.trim();
  let list = Api.db.listings.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  if (f === 'online') list = list.filter(l => l.status === 'online');
  if (f === 'offline') list = list.filter(l => l.status === 'offline');
  if (kw) list = list.filter(l => (l.parkName + l.building + l.floor).indexOf(kw) > -1);
  return `
  <div class="admin-toolbar">
    <div class="search-input">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5" stroke-linecap="round"/></svg>
      <input type="text" id="adminKw" placeholder="搜索园区 / 楼栋" value="${esc(State.adminKw)}">
    </div>
    <button class="btn sm" style="height:38px;padding:0 14px" type="button" data-act="admin:new">+ 新增</button>
  </div>
  <div class="filter-bar" style="padding-top:10px">
    ${[['all', '全部 ' + Api.db.listings.length],
      ['online', '在租 ' + Api.db.listings.filter(l => l.status === 'online').length],
      ['offline', '已下架 ' + Api.db.listings.filter(l => l.status === 'offline').length]]
      .map(p => `<button class="filter-chip ${f === p[0] ? 'on' : ''}" type="button" data-act="admin:filter" data-v="${p[0]}">${p[1]}</button>`).join('')}
    <button class="filter-chip" type="button" data-act="admin:export">导出 CSV</button>
  </div>
  <div style="height:2px"></div>
  ${list.length ? list.map(l => `
    <div class="admin-lrow">
      <div class="alimg"><img src="${photoURL((l.photos && l.photos[0]) || photoURI('facade', 0))}" alt=""></div>
      <div class="admin-lbody">
        <div class="admin-lname">${esc(publicListingTitle(l))}</div>
        <div class="admin-lmeta">${esc(l.floor)} · ${l.area}㎡ · ${esc(l.orientation)} · ${esc(l.decoration)} · ${esc(l.layout)}</div>
        <div class="admin-lmeta" style="color:var(--price);font-weight:600">${l.rent} 元/㎡·月 · 物业 ${l.propertyFee} 元 · 浏览 ${l.views}</div>
        <div class="admin-lops">
          ${statusPill(l.status)}
          <button class="op-btn ${l.status === 'online' ? 'off' : 'on'}" type="button" data-act="admin:toggle" data-id="${l.id}">${l.status === 'online' ? '下架' : '上架'}</button>
          <button class="op-btn pri" type="button" data-act="admin:edit" data-id="${l.id}">编辑</button>
          <button class="op-btn del" type="button" data-act="admin:del" data-id="${l.id}">删除</button>
        </div>
      </div>
    </div>`).join('') : '<div class="empty">暂无房源，点击右上角「+ 新增」添加</div>'}
  <div style="height:10px"></div>`;
}

function adminMessageBody() {
  const msgs = Api.db.messages.slice().sort((a, b) =>
    (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || new Date(b.createdAt) - new Date(a.createdAt));
  const pending = msgs.filter(m => m.status === 'pending');
  return `
  <div class="pad" style="padding-top:12px">
    <div class="card" style="padding:12px;display:flex;gap:14px">
      <div style="flex:1;text-align:center"><b style="font-size:20px;color:var(--warn)">${pending.length}</b>
        <div style="font-size:11px;color:var(--text-3)">待回复</div></div>
      <div style="width:1px;background:var(--line)"></div>
      <div style="flex:1;text-align:center"><b style="font-size:20px;color:var(--success)">${msgs.length - pending.length}</b>
        <div style="font-size:11px;color:var(--text-3)">已回复</div></div>
      <div style="width:1px;background:var(--line)"></div>
      <div style="flex:1;text-align:center"><b style="font-size:20px;color:var(--primary)">${msgs.length}</b>
        <div style="font-size:11px;color:var(--text-3)">留言总数</div></div>
    </div>
  </div>
  ${msgs.length ? msgs.map(m => {
    const l = findListing(m.listingId);
    return `
    <div class="msg-item">
      <div class="msg-top">
        <div class="msg-listing">${esc(m.name)} · ${esc(m.phone)}</div>
        <span class="msg-status ${m.status === 'pending' ? 'pending' : 'done'}">${m.status === 'pending' ? '待回复' : m.status === 'closed' ? '已完成' : '已回复'}</span>
      </div>
      <div style="font-size:11.5px;color:var(--text-3);margin-top:6px">
        【${esc(m.type)}】${l ? esc(publicListingTitle(l)) : '房源已删除'}
      </div>
      <div class="msg-body">${esc(m.content)}</div>
      ${m.reply ? `<div class="msg-reply"><b>我的回复：</b>${esc(m.reply)}</div>` : ''}
      <div class="msg-meta"><span>${esc(m.createdAt)}</span></div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        <button class="op-btn pri" type="button" data-act="admin:reply" data-id="${m.id}">${m.reply ? '修改回复' : '回复'}</button>
        <button class="op-btn" type="button" data-act="call" data-v="${esc(m.phone)}">拨打电话</button>
        <button class="op-btn del" type="button" data-act="admin:delMsg" data-id="${m.id}">删除</button>
      </div>
    </div>`;
  }).join('') : '<div class="empty">暂无访客留言</div>'}
  <div style="height:10px"></div>`;
}

function adminDashboardBody() {
  const db = Api.db;
  const logs = db.visitLog.slice(-7);
  const maxV = Math.max(1, ...logs.map(x => x.v));
  const online = db.listings.filter(l => l.status === 'online').length;
  const offline = db.listings.length - online;
  const totalArea = db.listings.reduce((s, l) => s + l.area, 0);
  const rentAvg = db.listings.length ? Math.round(db.listings.reduce((s, l) => s + l.rent, 0) / db.listings.length) : 0;
  const top = db.listings.slice().sort((a, b) => b.views - a.views).slice(0, 5);
  const maxTop = Math.max(1, ...top.map(t => t.views));
  const pending = db.messages.filter(m => m.status === 'pending').length;
  const conv = db.stats.visitors ? (db.messages.length / db.stats.visitors * 100).toFixed(1) : '0.0';
  const parkStat = {};
  db.listings.forEach(l => { parkStat[l.parkName] = (parkStat[l.parkName] || 0) + 1; });
  const parkRank = Object.entries(parkStat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxPark = Math.max(1, ...parkRank.map(p => p[1]));

  return `
  <div class="stat-grid">
    <div class="stat-card">
      <div class="sc-label">房源总数</div><div class="sc-val">${db.listings.length}</div>
      <div class="sc-sub">在租 ${online} · 下架 ${offline}</div>
      <div class="sc-ico" style="background:var(--primary-l);color:var(--primary)">🏢</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">累计访客</div><div class="sc-val">${db.stats.visitors}</div>
      <div class="sc-sub">今日 ${db.stats.todayVisitors} 人</div>
      <div class="sc-ico" style="background:#E6F7EF;color:var(--success)">👥</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">累计浏览量</div><div class="sc-val">${db.stats.views}</div>
      <div class="sc-sub">今日 ${db.stats.todayViews || 0} 次</div>
      <div class="sc-ico" style="background:#FFF3E4;color:#D97706">👁</div>
    </div>
    <div class="stat-card">
      <div class="sc-label">咨询留言</div><div class="sc-val">${db.messages.length}</div>
      <div class="sc-sub">待处理 ${pending} · 转化率 ${conv}%</div>
      <div class="sc-ico" style="background:#FDECEC;color:var(--danger)">💬</div>
    </div>
  </div>

  <div class="chart-card">
    <h3>近 7 日访客趋势 <small>单位：人次</small></h3>
    <div class="bars">
      ${logs.map(x => `
        <div class="bar-col">
          <span class="bar-val">${x.v}</span>
          <div class="bar" style="height:${Math.max(4, Math.round(x.v / maxV * 88))}%"></div>
          <span class="bar-lab">${x.d.slice(5)}</span>
        </div>`).join('')}
    </div>
  </div>

  <div class="chart-card">
    <h3>房源浏览量 TOP5 <small>累计浏览</small></h3>
    <div class="rank-list">
      ${top.map((t, i) => `
        <div class="rank-item">
          <div class="rank-no">${i + 1}</div>
          <div class="rank-name">${esc(t.parkName)} · ${esc(t.building)}</div>
          <div class="rank-bar"><i style="width:${Math.round(t.views / maxTop * 100)}%"></i></div>
          <div class="rank-val">${t.views}</div>
        </div>`).join('')}
    </div>
  </div>

  <div class="chart-card">
    <h3>园区房源分布 <small>按套数</small></h3>
    <div class="rank-list">
      ${parkRank.map(p => `
        <div class="rank-item">
          <div class="rank-name">${esc(p[0])}</div>
          <div class="rank-bar" style="width:90px;flex:0 0 90px"><i style="width:${Math.round(p[1] / maxPark * 100)}%"></i></div>
          <div class="rank-val">${p[1]} 套</div>
        </div>`).join('')}
    </div>
  </div>

  <div class="chart-card">
    <h3>经营概览 <small>数据汇总</small></h3>
    <div class="info-rows">
      <div class="info-item"><span class="info-k">可租面积</span><span class="info-v">${money(totalArea)} ㎡</span></div>
      <div class="info-item"><span class="info-k">平均租金</span><span class="info-v">${rentAvg} 元/㎡</span></div>
      <div class="info-item"><span class="info-k">登记访客</span><span class="info-v">${db.visitors.length} 人</span></div>
      <div class="info-item"><span class="info-k">管理员</span><span class="info-v">${db.admins.length} / ${db.settings.maxAdmins} 人</span></div>
      <div class="info-item full"><span class="info-k">数据更新</span><span class="info-v">${fmtDateTime(new Date())}</span></div>
    </div>
    <div style="display:flex;gap:9px;margin-top:12px">
      <button class="btn sm ghost" style="flex:1;height:36px" type="button" data-act="admin:export">导出房源 CSV</button>
      <button class="btn sm ghost" style="flex:1;height:36px" type="button" data-act="admin:exportVisitors">导出访客 CSV</button>
    </div>
  </div>
  <div style="height:10px"></div>`;
}

function adminSystemBody() {
  const db = Api.db;
  const adm = State.session.admin;
  const isSuper = adm && adm.role === 'super';
  return `
  <div class="notice-bar">
    <span>ℹ️</span>
    <span>管理员数量上限为 <b>${db.settings.maxAdmins}</b> 人，当前已创建 <b>${db.admins.length}</b> 人。仅超级管理员可新增、停用或删除管理员账号。</span>
  </div>

  <div class="chart-card" style="margin-top:12px">
    <h3>管理员账号 <small>${db.admins.length} / ${db.settings.maxAdmins}</small></h3>
    <div style="margin:0 -14px">
      ${db.admins.map(a => `
        <div class="admin-row">
          <div class="admin-avatar ${a.role === 'super' ? 'super' : (a.enabled ? '' : 'dis')}">${esc(a.name.slice(0, 1))}</div>
          <div class="admin-info">
            <div class="admin-uname">${esc(a.name)}
              ${a.role === 'super' ? '<span class="role-chip">超级管理员</span>' : ''}
              ${a.enabled ? '' : '<span class="role-chip" style="background:#EEF1F6;color:var(--text-3)">已停用</span>'}
            </div>
            <div class="admin-meta">账号 ${esc(a.username)} · ${esc(a.phone || '未填手机号')}</div>
            <div class="admin-meta">创建 ${esc(a.createdAt)} · 最近登录 ${esc(a.lastLogin || '从未登录')}</div>
          </div>
          ${(() => {
            const canToggle = isSuper && a.role !== 'super';
            const canPwd = isSuper || (adm && a.id === adm.id);
            if (!canToggle && !canPwd) return '<div style="flex:0 0 auto;color:var(--text-3);font-size:12px">—</div>';
            return `<div style="display:flex;flex-direction:column;gap:6px;flex:0 0 auto">
              ${canPwd ? `<button class="op-btn" type="button" data-act="admin:resetPwd" data-id="${a.id}">改密</button>` : ''}
              ${canToggle ? `<button class="op-btn ${a.enabled ? 'off' : 'on'}" type="button" data-act="admin:toggleAdmin" data-id="${a.id}">${a.enabled ? '停用' : '启用'}</button>
              <button class="op-btn del" type="button" data-act="admin:delAdmin" data-id="${a.id}">删除</button>` : ''}
            </div>`;
          })()}
        </div>`).join('')}
    </div>
    ${isSuper ? `<button class="btn" style="margin-top:14px" type="button" data-act="admin:newAdmin">+ 新增管理员</button>`
      : '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:14px 0 4px">当前账号无管理员管理权限</div>'}
  </div>

  <div class="chart-card">
    <h3>平台参数</h3>
    <div class="field"><label>平台名称</label><input type="text" id="setSiteName" value="${esc(db.settings.siteName)}" ${isSuper ? '' : 'disabled'}></div>
    <div class="field"><label>招商热线</label><input type="text" id="setHotline" value="${esc(db.settings.hotline)}" ${isSuper ? '' : 'disabled'}></div>
    <div class="field"><label>管理员数量上限<span class="req">*</span></label>
      <input type="number" id="setMaxAdmins" min="1" max="20" value="${db.settings.maxAdmins}" ${isSuper ? '' : 'disabled'}>
    </div>
    ${isSuper ? '<button class="btn" style="margin-top:14px" type="button" data-act="admin:saveSettings">保存设置</button>'
      : '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:6px 0 0">仅超级管理员可修改平台参数</div>'}
  </div>

  <div class="chart-card">
    <h3>登录验证 / 分享 / 在线地图</h3>
    <div style="font-size:12px;color:var(--text-2);line-height:1.8;margin-bottom:12px">
      游客登录需短信验证码校验。当前为演示通道，验证码直接显示在页面上；接入真实短信平台后，把 <code>data.js</code> 中 <code>Sms.send()</code> 换成后端接口即可。
    </div>
    <div class="field-row">
      <div class="field"><label>验证码有效期（秒）</label>
        <input type="number" id="setSmsTtl" min="60" max="1800" value="${(db.settings.sms || {}).ttlSec || 300}" ${isSuper ? '' : 'disabled'}></div>
      <div class="field"><label>发送间隔（秒）</label>
        <input type="number" id="setSmsCd" min="30" max="300" value="${(db.settings.sms || {}).cooldownSec || 60}" ${isSuper ? '' : 'disabled'}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>最大尝试次数</label>
        <input type="number" id="setSmsMax" min="3" max="10" value="${(db.settings.sms || {}).maxTry || 5}" ${isSuper ? '' : 'disabled'}></div>
      <div class="field" style="display:flex;align-items:flex-end;padding-bottom:14px">
        <label class="remember-row" style="border:none;padding:0">
          <input type="checkbox" id="setSmsDemo" ${(db.settings.sms || {}).demoShow !== false ? 'checked' : ''} ${isSuper ? '' : 'disabled'}>
          <span>演示模式显示验证码</span></label>
      </div>
    </div>
    <div class="field"><label>微信公众号 AppID <span style="color:var(--text-3);font-weight:400">（可选，用于微信原生转发）</span></label>
      <input type="text" id="setWxAppId" value="${esc((db.settings.wx || {}).appId || '')}" placeholder="填入已认证公众号 AppID 后启用" ${isSuper ? '' : 'disabled'}>
    </div>
    <div class="field"><label>公众号 AppSecret <span style="color:var(--text-3);font-weight:400">（与 AppID 配套，转发卡片才会带房源缩略图与描述）</span></label>
      <input type="password" id="setWxSecret" value="${esc((db.settings.wx || {}).appSecret || '')}" placeholder="公众号后台-设置与开发-基本配置中获取" ${isSuper ? '' : 'disabled'}>
    </div>
    <div style="font-size:11.5px;color:var(--text-3);line-height:1.7;margin-top:4px">
      配置后，微信里点右上角「发送给朋友」的卡片将自动带房源标题、参数描述和缩略图；需在公众号后台把本站域名加入「JS接口安全域名」。
    </div>

    <div class="field" style="margin-top:14px"><label>腾讯位置服务 Key <span style="color:var(--text-3);font-weight:400">（在线地图 / 房源精准定位）</span></label>
      <input type="text" id="setTmapKey" value="${esc(db.settings.tmapKey || '')}" placeholder="填入腾讯位置服务 Key 后启用在线地图" ${isSuper ? '' : 'disabled'}>
    </div>
    <div style="font-size:11.5px;color:var(--text-3);line-height:1.7;margin-top:4px">
      到 <b>lbs.qq.com</b>（腾讯位置服务）免费申请 Key，勾选「WebServiceAPI」与「JavaScript API GL」，并把本站域名
      <code>a3083699bead4f4d9f7d2dee18fa7297.app.workbuddy.host</code> 加入白名单。留空则地图页使用内置静态底图。
    </div>
    ${isSuper ? '<button class="btn" style="margin-top:14px" type="button" data-act="admin:saveIntegrations">保存短信与分享设置</button>'
      : '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:6px 0 0">仅超级管理员可修改</div>'}
  </div>

  <div class="chart-card">
    <h3>转发卡片设置</h3>
    <div style="font-size:12px;color:var(--text-2);line-height:1.8;margin-bottom:12px">
      自定义转发到微信时展示的标题、描述与封面图。留空则使用默认值；分享海报与公众号 JS-SDK 转发即时生效。
    </div>
    <div class="field"><label>转发标题</label>
      <input type="text" id="setShareTitle" value="${esc((db.settings.share || {}).title || '')}" placeholder="${esc((seedShareDefaults()).title)}" ${isSuper ? '' : 'disabled'}></div>
    <div class="field"><label>转发描述</label>
      <input type="text" id="setShareDesc" value="${esc((db.settings.share || {}).desc || '')}" placeholder="${esc((seedShareDefaults()).desc)}" ${isSuper ? '' : 'disabled'}></div>
    <div class="field"><label>封面图 <span style="color:var(--text-3);font-weight:400">（建议 500×400，5:4）</span></label>
      <div style="display:flex;align-items:center;gap:12px">
        <div id="shareImgPrev" style="width:90px;height:72px;border-radius:8px;background:#F1F5FB center/cover no-repeat;${(db.settings.share || {}).img ? `background-image:url('${(db.settings.share || {}).img}')` : ''}"></div>
        <div style="flex:1">
          <button class="btn sm ghost" type="button" data-act="admin:pickShareImg" ${isSuper ? '' : 'disabled'}>${(db.settings.share || {}).img ? '更换封面图' : '上传封面图'}</button>
          ${((db.settings.share || {}).img && isSuper) ? '<button class="btn sm ghost" style="margin-left:8px;color:var(--danger)" type="button" data-act="admin:clearShareImg">清除</button>' : ''}
        </div>
      </div>
      <input type="file" id="shareImgInput" accept="image/*" style="display:none">
    </div>
    ${isSuper ? '<button class="btn" style="margin-top:14px" type="button" data-act="admin:saveShare">保存转发设置</button>'
      : '<div style="font-size:12px;color:var(--text-3);text-align:center;padding:6px 0 0">仅超级管理员可修改</div>'}
  </div>

  <div class="chart-card">
    <h3>备份与恢复</h3>
    <div style="font-size:12px;color:var(--text-2);line-height:1.8;margin-bottom:12px">
      系统在每次打开、升级版本、恢复数据前都会自动备份快照（保留最近 5 份）。版本更新<b>不会改动</b>房源、管理员、园区、留言等任何数据。
    </div>
    <button class="btn" style="margin-bottom:12px" type="button" data-act="admin:backupNow">立即备份一份快照</button>
    <div id="backupList">${backupListHTML()}</div>
  </div>

  <div class="chart-card">
    <h3>数据管理</h3>
    <div style="font-size:12px;color:var(--text-2);line-height:1.8;margin-bottom:12px">
      「恢复演示数据」会先用快照备份你当前的数据，再还原初始示例；「清空」只清本机浏览器缓存，<b>云端数据不受影响</b>，重新打开页面会自动从云端恢复。
    </div>
    <button class="btn ghost" type="button" data-act="admin:reset">恢复演示数据</button>
    <button class="btn" style="margin-top:10px;background:var(--danger)" type="button" data-act="admin:clearAll">清空本机缓存数据</button>
  </div>
  <div style="height:10px"></div>`;
}

/* ---------------- 转发卡片自定义 ---------------- */
function fmtBackupTime(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function backupListHTML() {
  const list = Api.backups();
  if (!list.length) return '<div style="font-size:12px;color:var(--text-3)">暂无备份，点击上方按钮立即创建</div>';
  return list.map((b, i) => `
    <div class="anno-row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
      <div style="font-size:12px;color:var(--text-2);line-height:1.6">
        <b>${fmtBackupTime(b.ts)}</b> · ${b.reason === 'manual' ? '手动' : b.reason === 'reset' ? '重置前' : b.reason === 'before-restore' ? '恢复前' : '自动'}
        <div style="color:var(--text-3)">${esc(b.counts || '')}</div>
      </div>
      <button class="btn ghost" style="padding:4px 12px;font-size:12px" type="button" data-act="admin:restoreBackup" data-i="${i}">恢复</button>
    </div>`).join('');
}
function refreshBackupList() {
  const el = $('#backupList');
  if (el) el.innerHTML = backupListHTML();
}
function seedShareDefaults() {
  return (typeof seedDB === 'function' ? seedDB().settings.share : { title: '', desc: '' }) || { title: '', desc: '' };
}

/* 房源页的页面级分享元数据：与服务器注入保持一致，
   避免页面加载后被 applyShareMeta() 的站点信息覆盖（部分平台读的是实时 DOM） */
function applyListingShareMeta(l) {
  const set = (sel, v) => {
    try {
      const el = document.querySelector(sel);
      if (el && v && typeof el.setAttribute === 'function') el.setAttribute('content', v);
    } catch (e) { }
  };
  const t = `${publicListingTitle(l)} ${l.area}㎡ ${l.rent==null?'租金面议':l.rent+'元/㎡·月'}`;
  const d = `${l.floor} · ${l.orientation}向 · ${l.decoration} · ${l.layout}，物业费 ${l.propertyFee} 元/㎡·月`;
  const img = (l.photos || [])[0] || SHARE_BASE + '/assets/songshanhu-map.jpg';
  set('meta[property="og:title"]', t);
  set('meta[property="og:description"]', d);
  set('meta[property="og:image"]', img);
  set('meta[property="og:url"]', shareLink({ id: l.id }));
  set('meta[name="twitter:title"]', t);
  set('meta[name="twitter:description"]', d);
  set('meta[name="twitter:image"]', img);
  set('meta[itemprop="name"]', t);
  set('meta[itemprop="description"]', d);
  set('meta[itemprop="image"]', img);
}

/* 应用转发设置到页面 meta（对 JS-SDK 与海报即时生效） */
function applyShareMeta() {
  /* 房源详情页：页面级分享信息用该房源（标题/参数/首图），不要退回站点信息 */
  if (State.view === 'detail' && State.params.id) {
    const l = findListing(State.params.id);
    if (l) return applyListingShareMeta(l);
  }
  const s = (Api.db.settings.share || {});
  const set = (sel, v) => {
    try {
      const el = document.querySelector(sel);
      if (el && v && typeof el.setAttribute === 'function') el.setAttribute('content', v);
    } catch (e) { }
  };
  set('meta[property="og:title"]', s.title);
  set('meta[property="og:description"]', s.desc);
  set('meta[property="og:image"]', s.img);
  set('meta[name="twitter:title"]', s.title);
  set('meta[name="twitter:description"]', s.desc);
  set('meta[name="twitter:image"]', s.img);
  set('meta[itemprop="name"]', s.title);
  set('meta[itemprop="image"]', s.img);
}

/* 上传转发封面：压缩到 500 宽 JPEG（约 60-90KB） */
function pickShareImage() {
  const inp = $('#shareImgInput');
  if (!inp) return;
  inp.onchange = () => {
    const file = inp.files && inp.files[0];
    inp.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type)) return toast('请选择图片文件');
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const W = 500;
        const scale = Math.min(1, W / img.width);
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const out = cv.toDataURL('image/jpeg', 0.82);
        const prev = $('#shareImgPrev');
        if (prev) prev.style.backgroundImage = `url('${out}')`;
        if (!State.shareDraft) State.shareDraft = {};
        State.shareDraft.img = out;
        const btn = document.querySelector('[data-act="admin:pickShareImg"]');
        if (btn) btn.textContent = '更换封面图';
        toast('封面图已就绪，点「保存转发设置」生效');
      };
      img.onerror = () => toast('图片解析失败');
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  inp.click();
}

function saveShareSettings() {
  const s = Api.db.settings.share || (Api.db.settings.share = {});
  const t = $('#setShareTitle'), d = $('#setShareDesc');
  if (t) s.title = t.value.trim();
  if (d) s.desc = d.value.trim();
  if (State.shareDraft && State.shareDraft.img !== undefined) s.img = State.shareDraft.img;
  Api.save();
  Cloud.markDirtyKeys(['share']);
  Cloud.pushMeta();
  applyShareMeta();
  toast('转发设置已保存，已同步到云端');
}

/* ---------------- AI 找房助手（服务端 DeepSeek；错误明确展示，不伪装本地结果） ---------------- */
function sheetAiMatch() {
  openSheet(`
    <div class="sheet-head"><h3>智能找房</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body" style="padding-bottom:18px">
      <div class="ai-intro">AI 根据本站已发布房源理解需求并推荐。需求与公开房源资料将发送至 AI 服务，请勿填写私人信息。</div>
      <div class="ai-quick">
        ${['厂房，3000平以上', '写字楼，预算30元以内', '200-500平，带家具', '每月预算10000元'].map(t =>
    `<button class="hot-chip" type="button" data-act="ai:quick" data-v="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <div class="ai-result" id="aiResult">
        <div class="ai-tip">👇 在下方输入需求，或点上面的快捷问题试试</div>
      </div>
      <div class="ai-row">
        <input type="text" id="aiInput" placeholder="例：厂房3000平以上，或月租10000元以内" maxlength="80">
        <button class="btn" type="button" data-act="ai:ask">发送</button>
      </div>
    </div>`);
  const inp = $('#aiInput');
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); aiAsk(); } };
}

function aiRenderResult(reply, ids) {
  const box = $('#aiResult');
  if (!box) return;
  const ls = (ids || []).map(findListing).filter(Boolean);
  box.innerHTML = `<div class="ai-bubble">${esc(reply)}</div>` +
    (ls.length
      ? `<div class="ai-list">${ls.map(listingCard).join('')}</div>`
      : '<div class="ai-tip">暂未匹配到合适房源，可放宽条件，或返回首页拨打招商热线直接咨询。</div>');
  box.scrollTop = 0;
}

async function aiAsk(preset) {
  const inp=$('#aiInput'),q=String(preset||inp?.value||'').trim();
  if(!q)return toast('先说说你的需求吧');
  if(State.aiPending)return;
  State.aiPending=true;
  const box=$('#aiResult');
  if(box)box.innerHTML='<div class="ai-tip" role="status">正在查找本站已发布房源…</div>';
  try{
    const result=await window.SiteAI.search(q);
    aiRenderResult(result.reply,result.ids);
  }catch(error){if(box)box.innerHTML='<div class="ai-tip" role="alert">'+esc(error.message)+'</div>';}
  finally{State.aiPending=false;}
}

/* ---------------- 视图切换 ---------------- */
const TAB_META = { home: '松山湖产业招商网站', message: '我的留言', mine: '我的' };
const VIEW_TITLE = { detail: '房源详情', admin: '管理后台', resources: '产业资源' };
const TAB_VIEWS = ['home', 'message', 'mine'];
const ICONS = {
  home: '<path d="M3 10l9-7 9 7v10a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M9 21V12h6v9"/>',
  map: '<path d="M9 3L3 5.5v15L9 18l6 3 6-2.5v-15L15 6z"/><path d="M9 3v15M15 6v15"/>',
  message: '<path d="M4 5h16v11H9l-5 4z" stroke-linejoin="round"/>',
  mine: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/>'
};

const SITE_TITLE = '松山湖产业招商网站';

/* URL 跟随当前视图：详情页时地址栏带 ?id=房源号，
   微信里点右上角 ●··· →「发送给朋友」即可直接把本房源发给好友 */
function syncUrl() {
  try {
    const u = new URL(location.href);
    if (State.view === 'detail' && State.params.id) {
      if (u.searchParams.get('id') === State.params.id) return;
      u.searchParams.set('id', State.params.id);
    } else {
      if (!u.searchParams.has('id')) return;
      u.searchParams.delete('id');
    }
    history.replaceState(null, '', u.pathname + u.search + (u.hash || ''));
  } catch (e) { /* 某些容器不支持，静默跳过 */ }
}

/* 标题跟随：微信右上角转发卡片标题取自 document.title */
function syncTitle() {
  if (State.view === 'detail' && State.params.id) {
    const l = findListing(State.params.id);
    if (l) {
      document.title = publicListingTitle(l) + ' · ' + (l.rent==null?'租金面议':l.rent+'元/㎡·月');
      applyListingShareMeta(l);   /* 页面 meta 同步为房源信息 */
      /* 已接入公众号 JS-SDK 时，实时刷新转发卡片内容（标题/描述/缩略图/深链） */
      if (WxShare.ready || WxShare.pending) {
        try { WxShare.update(shareCtx('listing', l.id)); } catch (e) { }
      }
      return;
    }
  }
  document.title = SITE_TITLE;
  if (WxShare.ready || WxShare.pending) {
    try { WxShare.update(shareCtx('site')); } catch (e) { }
  }
}

function setView(name, push, navigation = {}) {
  if (name === 'map') name = 'home'; // Old navigation state cannot reopen the removed map.
  const previousView = State.view;
  if (name === 'admin') { window.location.href = ((window.__SITE_BACKEND__ || {}).basePath || '') + '/admin/'; return; }
  const pageMotion = window.SitePages?.prepare(previousView, name, push, navigation);
  if (push && State.view !== name) State.stack.push({ v: State.view, p: Object.assign({}, State.params), scrollTop: $('#view-' + State.view)?.scrollTop || 0 });
  State.view = name;
  if (name === 'message') window.refreshSiteReplies?.();
  const isTab = TAB_VIEWS.indexOf(name) > -1;
  $$('.view').forEach(el => el.classList.remove('active'));
  const el = $('#view-' + name);
  if (el) { el.classList.add('active'); el.scrollTop = 0; }
  if (isTab) State.tab = name;

  $('#navTitle').textContent = (name === 'admin' && State.session.admin) ? '管理后台' : (isTab ? TAB_META[name] : (VIEW_TITLE[name] || '松山湖产业招商网站'));
  $('#navBack').classList.toggle('show', !isTab);
  let navRight = '';
  if (!isTab && name === 'detail') {
    navRight = `<button class="nav-btn" type="button" data-act="open:share" data-id="${esc(State.params.id || '')}">分享</button>`
      + '<button class="nav-btn ghost" type="button" data-act="tab" data-v="home">首页</button>';
  } else if (!isTab) {
    navRight = '<button class="nav-btn ghost" type="button" data-act="tab" data-v="home">首页</button>';
  } else if (name === 'home') {
    navRight = '<button class="nav-btn ghost" type="button" data-act="open:share" data-v="site">分享</button>'
      + '<button class="nav-btn" type="button" data-act="open:parkPicker">片区</button>';
  }
  $('#navRight').innerHTML = navRight;

  document.documentElement.dataset.view = name;
  updateSiteHeader();
  renderTabbar();
  render();
  if (el && Number.isFinite(navigation.scrollTop)) el.scrollTop = navigation.scrollTop;
  if (pageMotion) window.SitePages.enter(pageMotion, el);
  else window.SiteTabs?.enter(previousView, name, el);
  syncUrl();
  syncTitle();
}

function updateSiteHeader() {
  const desktop = window.matchMedia('(min-width:900px)').matches;
  $('#navTitle').textContent = desktop ? (Api.db.settings.siteName || '松山湖产业招商') : (TAB_META[State.view] || VIEW_TITLE[State.view] || '松山湖产业招商');
  $$('.desktop-nav button').forEach(button => {
    const active = button.dataset.v === State.view || (button.dataset.act === 'open:resources' && State.view === 'resources');
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
}
window.matchMedia('(min-width:900px)').addEventListener('change', updateSiteHeader);

function back(navigation = {}) {
  const prev = State.stack.pop();
  if (prev) { State.params = prev.p || {}; setView(prev.v, false, {...navigation, scrollTop: prev.scrollTop || 0}); }
  else setView('home', false, navigation);
}

function renderTabbar() {
  const isTab = TAB_VIEWS.indexOf(State.view) > -1;
  const bar = $('#tabbar');
  bar.classList.toggle('hide', !isTab);
  if (!isTab) return;
  const pending = State.session.visitor
    ? Api.db.messages.filter(m => m.visitorId === State.session.visitor.id && m.status === 'pending').length : 0;
  const items = [
    { k: 'home', t: '首页' }, { k: 'message', t: '留言' }, { k: 'mine', t: '我的' }
  ];
  // Keep the same buttons between views so focus and the sliding indicator survive.
  if (!bar.querySelector('.tab-rail')) bar.innerHTML = '<div class="tab-rail"><span class="tab-indicator" aria-hidden="true"></span>' + items.map(it => `
    <button class="tab-item" type="button" data-act="tab" data-v="${it.k}" aria-label="${it.t}" aria-controls="view-${it.k}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[it.k]}</svg>
      <span class="tab-label" aria-hidden="true">${it.t}</span>
      <i class="tab-badge" hidden aria-hidden="true"></i>
    </button>`).join('') + '</div>';
  bar.querySelectorAll('.tab-item').forEach(button => {
    const active = button.dataset.v === State.tab;
    button.classList.toggle('on', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    const badge = button.querySelector('.tab-badge');
    const count = button.dataset.v === 'message' ? pending : 0;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count || '');
    button.setAttribute('aria-label', items.find(it => it.k === button.dataset.v).t + (count ? '，'+count+'条待处理留言' : ''));
  });
  window.SiteTabs?.sync();
}

/* 打开房源详情（列表卡片、地图标记、留言关联等处统一复用） */
function openListing(id) {
  if (!id) return toast('房源编号缺失');
  State.params.id = id;          /* 关键：进入详情前必须带上房源 ID */
  State.deepPending = null;
  State.session.viewed = [id].concat((State.session.viewed || []).filter(x => x !== id)).slice(0, 20);
  Api.logView(id);
  saveSession();
  setView('detail', true);
}

/* 详情页：已精准定位的房源显示在线地图 */
function bindDetailMap() {
  // Location is private; no map SDK is loaded on detail pages.
}

function render() {
  const map = { home: renderHome, message: renderMessage, mine: renderMine, detail: renderDetail, admin: renderAdmin, resources: renderResources };
  const fn = map[State.view];
  const el = $('#view-' + State.view);
  window.SiteMotion?.beforeRender(el);
  window.HomeFilterChips?.beforeRender(el);
  window.HomeSearch?.beforeRender(el);
  window.DetailGallery?.destroy();
  if (el && fn) el.innerHTML = fn();
  window.HomeFilterChips?.afterRender(el);
  window.SiteMotion?.afterRender(el);
  window.HomeSearch?.afterRender(el);
  if (State.view === 'detail') bindGallery();
  if (State.view === 'home') bindHome();
  if (State.view === 'resources' && el) bindResources(el);
  if (State.view === 'admin') bindAdmin();
  if (State.view === 'admin' && State.adminTab === 'map') bindAnnotateMap();
}
function refresh() { render(); renderTabbar(); }

/* ---------------- 局部绑定 ---------------- */
function bindHome() { window.HomeSearch?.bind(); }

function bindGallery() { window.DetailGallery?.bind(); }

function bindMap() {
  // Map finding has been retired.
}

/* 在线地图挂载：园区标记 + 选中园区的已定位房源标记 */
function mountTmap() {
  const host = $('#mapHost');
  if (!host || $('#tmapCanvas')) return;
  const holder = document.createElement('div');
  holder.className = 'tmap-canvas';
  holder.id = 'tmapCanvas';
  host.innerHTML = '';
  host.appendChild(holder);
  const stage = $('#mapStage');
  if (stage) stage.classList.add('is-online');
  try {
    const T = MapKit.T, c = MapKit.center();
    const groups = mapGroups();
    const sel = State.mapPark;
    /* 视图优先级：本次点选的园区 > 上次浏览位置 > 松山湖默认中心 */
    const fp = State.tmapFocus ? groups.find(g => g.park.name === State.tmapFocus) : null;
    const focus = fp && fp.park.lat && fp.park.lon ? { lat: fp.park.lat, lng: fp.park.lon, zoom: 15 } : null;
    State.tmapFocus = null;
    const iv = focus || State.tmapView;
    const map = new T.Map(holder, {
      center: new T.LatLng(iv ? iv.lat : c.lat, iv ? iv.lng : c.lng),
      zoom: iv ? iv.zoom : 13
    });
    State.tmap = map;

    const parks = groups.filter(g => g.park.lat && g.park.lon).map(g => ({
      id: g.park.name, styleId: 'park',
      position: new T.LatLng(g.park.lat, g.park.lon)
    }));
    /* 选中园区时，把该园区已精准定位的房源也标出来 */
    const ls = [];
    if (sel) {
      Api.db.listings.filter(l => l.parkName === sel && l.lat && l.lng).forEach(l => {
        ls.push({ id: l.id, styleId: 'listing', position: new T.LatLng(l.lat, l.lng) });
      });
    }
    const markers = new T.MultiMarker({
      map,
      styles: {
        park: new T.MarkerStyle({ width: 28, height: 36 }),
        listing: new T.MarkerStyle({ width: 20, height: 26 })
      },
      geometries: parks.concat(ls)
    });
    markers.on('click', evt => {
      const g = evt.geometry || {};
      if (g.styleId === 'listing') return openListing(g.id);
      try {
        const c0 = map.getCenter();
        State.tmapView = { lat: c0.getLat(), lng: c0.getLng(), zoom: map.getZoom() };
      } catch (e) { }
      State.mapPark = (State.mapPark === g.id ? '' : g.id);
      refresh();
    });
    /* 点击园区标记后展示信息卡片 */
    if (sel) {
      const g = groups.find(x => x.park.name === sel);
      const card = $('#tmapCard');
      if (g && card) {
        card.classList.remove('hide');
        card.innerHTML = `<b>${esc(g.park.name)}</b><span>${g.total} 套房源 · ${g.list.length} 套在租</span>
          <button class="op-btn" type="button" data-act="map:park" data-v="">取消</button>`;
      }
    }
    const ld = $('#mapLoading');
    if (ld) ld.remove();
  } catch (e) {
    console.warn('在线地图初始化失败，回退静态底图', e);
    const stage2 = $('#mapStage');
    if (stage2) stage2.classList.remove('is-online');
    try { refresh(); } catch (e2) { }
  }
}

function bindStaticMapGestures() {
  const stage = $('#mapStage'), inner = $('#mapInner');
  if (!stage || !inner) return;
  const apply = () => { inner.style.transform = `translate(${State.mapX}px,${State.mapY}px) scale(${State.mapScale})`; };
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.marker') || e.target.closest('.marker-label') ||
      e.target.closest('.map-zoom') || e.target.closest('.map-back')) return;
    dragging = true; sx = e.clientX; sy = e.clientY; ox = State.mapX; oy = State.mapY;
    if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) { } }
  });
  stage.addEventListener('pointermove', e => {
    if (!dragging) return;
    State.mapX = ox + (e.clientX - sx);
    State.mapY = oy + (e.clientY - sy);
    apply();
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => stage.addEventListener(ev, () => { dragging = false; }));
  stage.addEventListener('wheel', e => {
    e.preventDefault();
    State.mapScale = Math.min(2.4, Math.max(1, +(State.mapScale + (e.deltaY > 0 ? -0.15 : 0.15)).toFixed(2)));
    apply();
  }, { passive: false });
  let pd = 0;
  stage.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pd) State.mapScale = Math.min(2.4, Math.max(1, +(State.mapScale * (d / pd)).toFixed(3)));
      pd = d; apply();
    }
  }, { passive: true });
  stage.addEventListener('touchend', () => { pd = 0; });
}

/* ---------------- 管理端：地图标注 ---------------- */
function adminMapBody() {
  const items = parksAll().map(p => ({
    p, c: Api.parkCoord(p.name),
    total: Api.db.listings.filter(l => l.parkName === p.name).length
  }));
  const custom = items.filter(i => i.c.custom).length;
  return `
  <div class="notice-bar">
    <span>📍</span>
    <span>园区标记已按<b>真实经纬度</b>标定在底图上（底图每像素约 12.3 米）。若某个园区与实际位置有偏差，直接<b>拖动标记</b>微调，松手即保存，游客端实时生效。</span>
  </div>

  <div class="chart-card" style="margin-top:12px">
    <h3>底图标注 <small>已手动校准 ${custom} / ${parksAll().length}</small></h3>
    <div class="anno-stage" id="annoStage">
      <img class="map-img" src="assets/songshanhu-map.jpg" alt="松山湖写字楼分布图" draggable="false">
      ${items.map(it => `
        <div class="marker anno ${it.c.custom ? 'is-custom' : ''}" style="left:${it.c.x}%;top:${it.c.y}%"
             data-park="${esc(it.p.name)}" data-x="${it.c.x}" data-y="${it.c.y}">
          <div class="marker-pin"><span>${it.total}</span></div>
        </div>
        <div class="marker-label plain" style="left:${it.c.x}%;top:${it.c.y}%">${esc(it.p.name.replace('松山湖', ''))}</div>`).join('')}
    </div>
    <div class="anno-hint">蓝色标记 = 内置标定坐标；橙色标记 = 已被管理员手动校准。拖动松手后写入本地数据。</div>
    <button class="btn ghost" style="margin-top:10px" type="button" data-act="admin:resetParkAll">恢复全部默认坐标</button>
  </div>

  <div class="chart-card">
    <h3>坐标明细</h3>
    <div style="margin:0 -14px">
      ${items.map(it => `
        <div class="anno-row">
          <div style="flex:1;min-width:0">
            <div class="anno-name">${esc(it.p.name)}
              ${it.c.custom ? '<span class="role-chip" style="background:#FFF1E6;color:#D97706">已校准</span>'
      : (it.p.precise ? '<span class="role-chip" style="background:#E8F2FF;color:#1677FF">精确坐标</span>'
        : '<span class="role-chip" style="background:#EEF1F6;color:#8794A6">估算坐标</span>')}
            </div>
            <div class="anno-meta">${esc(it.p.addr)}<br>
              经纬度 ${it.p.lat.toFixed(5)}, ${it.p.lon.toFixed(5)} · 底图 ${it.c.x}% / ${it.c.y}% · ${it.total} 套房源</div>
          </div>
          ${it.c.custom ? `<button class="op-btn" type="button" data-act="admin:resetPark" data-v="${esc(it.p.name)}">还原</button>` : ''}
        </div>`).join('')}
    </div>
  </div>
  <div style="height:10px"></div>`;
}

function bindAnnotateMap() {
  const stage = $('#annoStage');
  if (!stage) return;
  let drag = null;
  stage.addEventListener('pointerdown', e => {
    const m = e.target.closest('.marker.anno');
    if (!m) return;
    e.preventDefault();
    drag = { el: m, name: m.dataset.park };
    m.classList.add('dragging');
    if (stage.setPointerCapture) { try { stage.setPointerCapture(e.pointerId); } catch (err) { } }
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = stage.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100));
    const y = Math.min(100, Math.max(0, (e.clientY - r.top) / r.height * 100));
    drag.el.style.left = x + '%';
    drag.el.style.top = y + '%';
    drag.x = x; drag.y = y;
  });
  ['pointerup', 'pointercancel'].forEach(ev => stage.addEventListener(ev, () => {
    if (!drag) return;
    const { name, el, x, y } = drag;
    drag = null;
    el.classList.remove('dragging');
    if (x == null || y == null) return;
    Api.setParkCoord(name, x, y);
    const body = $('#adminBody');
    if (body) { body.innerHTML = adminMapBody(); bindAnnotateMap(); }
    toast(name + ' 位置已更新');
  }));
}

function bindAdmin() {
  const kw = $('#adminKw');
  if (!kw) return;
  let t = null;
  kw.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      State.adminKw = kw.value;
      const body = $('#adminBody');
      if (body) body.innerHTML = adminListingBody();
      const k2 = $('#adminKw');
      if (k2) { k2.focus(); k2.setSelectionRange(k2.value.length, k2.value.length); }
    }, 300);
  };
}

/* ---------------- 留言表单 ---------------- */
function sheetInquiry(listingId, type, prefill) {
  const l = findListing(listingId);
  if (listingId && !l) return toast('房源已下架，请重新选择房源后留言');
  const v = State.session.visitor;
  const pf = prefill || {};
  const cur = type || pf.type || MSG_TYPES[0];
  openSheet(`
    <div class="sheet-head">
      <h3>在线留言咨询</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div style="background:#F7FAFF;border-radius:10px;padding:11px;font-size:12.5px;color:var(--text-2);line-height:1.65">
        ${l ? `<b style="color:var(--text)">${esc(publicListingTitle(l))}</b><br>${esc(l.floor)} · ${l.area}㎡ · ${esc(l.orientation)}向 · ${l.rent} 元/㎡·月` : '网站留言咨询 · 留下需求，招商顾问会在后台处理'}
      </div>
      ${v ? '' : `<div class="gate-tip">
        <b>可保存访客资料</b>：留下称呼和手机号，方便招商顾问联系你。
        <button class="op-btn pri" type="button" data-act="open:login" style="margin-left:8px">填写资料</button>
      </div>`}
      <div class="field"><label>咨询类型</label>
        <div class="seg" id="inqType">
          ${MSG_TYPES.map(t => `<button type="button" class="${cur === t ? 'on' : ''}" data-v="${t}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>称呼<span class="req">*</span></label>
          <input type="text" maxlength="40" id="inqName" value="${esc(v ? v.nick : (pf.name || ''))}" placeholder="怎么称呼您"></div>
        <div class="field"><label>手机号<span class="req">*</span></label>
          <input type="tel" maxlength="11" id="inqPhone" value="${esc(v ? v.phone : (pf.phone || Api.getPhone()))}" placeholder="方便顾问联系"></div>
      </div>
      <div class="field"><label>留言内容<span class="req">*</span></label>
        <textarea id="inqContent" maxlength="3800" placeholder="例如：想约本周六上午看房，能否分租 150㎡？">${esc(pf.content || (cur === '预约看房' && !prefill ? '想预约看房，请安排招商顾问与我联系。' : ''))}</textarea>
      </div>
      ${intakeConsentHTML('inqConsent')}
      <div style="font-size:11.5px;color:var(--text-3);line-height:1.7">
        提交后招商顾问可按你填写的联系方式与你联系。${l?.phone ? `也可直接拨打 ${esc(l.contact)} ${esc(l.phone)} 电话联系。` : ''}
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="submit:inquiry" data-id="${esc(listingId || '')}">提交留言</button>
    </div>`);
  const seg = $('#inqType');
  if (seg) seg.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('#inqType button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
  };
}

const intakeRequests = new Map();
async function sendVisitorIntake(payload) {
  const config=window.__SITE_BACKEND__||{};
  if(!config.url||!config.key)throw new Error('提交服务尚未连接，请稍后重试');
  const signature=JSON.stringify(payload);
  if(!intakeRequests.has(signature))intakeRequests.set(signature,crypto.randomUUID());
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch(String(config.url).replace(/\/$/,'')+'/rest/v1/rpc/submit_site_inquiry',{
      method:'POST',signal:controller.signal,
      headers:{apikey:config.key,Authorization:'Bearer '+config.key,'Content-Type':'application/json'},
      body:JSON.stringify({p_payload:{...payload,client_request_id:intakeRequests.get(signature)}})
    });
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(result?.message||'提交未完成，请稍后重试');
    if(!result?.id||!result?.receipt)throw new Error('未收到提交回执，请重试');
    return {...result,requestSignature:signature};
  } catch(error) {
    if(error.name==='AbortError')throw new Error('等待超时，请重试；相同内容重试不会重复登记。');
    throw error;
  } finally {clearTimeout(timeout);}
}
function storeVisitorReceipt(delivered,visitor,payload,type,content) {
  const message={id:delivered.id,receipt:delivered.receipt,requestSignature:delivered.requestSignature,details:payload.details||{},listingId:payload.listing_id||null,visitorId:visitor.id,name:payload.contact,phone:payload.phone,type,kind:payload.kind||'inquiry',content,createdAt:fmtDateTime(new Date()),status:'pending',reply:''};
  if(!Api.db.messages.some(x=>x.id===message.id))Api.db.messages.push(message);
  // Persist the profile independently of the larger catalog cache, then verify
  // both writes: Api.save() catches quota errors internally.
  State.session.visitor=visitor;
  try{
    saveSession();
    const session=Api.getSession();
    if(session.visitor?.id!==visitor.id) return false;
    if(payload.kind==='company'&&JSON.stringify(session.visitor.company)!==JSON.stringify(payload.details))return false;
    Api.save();
    const stored=JSON.parse(localStorage.getItem(DB_KEY)||'{}');
    return !!stored.messages?.some(item=>item.id===message.id&&item.receipt===message.receipt);
  }catch(_){return false;}
}
async function intakeForm(button,send) {
  if(!button||button.disabled)return;
  const controls=Array.from(document.querySelectorAll('#sheet button,#sheet input,#sheet textarea,#sheet select'));
  const original=button.textContent;button.dataset.pending='true';controls.forEach(x=>x.disabled=true);button.textContent='提交中…';
  document.getElementById('intakeRequestError')?.remove();
  try{await send();}catch(error){
    const note=document.createElement('p');note.id='intakeRequestError';note.className='inline-field-error';note.setAttribute('role','alert');note.textContent=(error.message||'网络连接失败，请重试')+'。填写内容已保留。';document.querySelector('#sheet .sheet-body')?.append(note);note.scrollIntoView({block:'nearest'});
  }finally{delete button.dataset.pending;controls.forEach(x=>x.disabled=false);button.textContent=original;}
}
async function submitInquiry(listingId) {
  const name=($('#inqName')?.value||'').trim(),phone=($('#inqPhone')?.value||'').trim(),content=($('#inqContent')?.value||'').trim();
  const type=$('#inqType .on')?.dataset.v||'其他问题';
  if(!name||name.length>40)return window.SiteMotion?.fieldError('inqName','请填写40字以内的称呼');
  if(!/^1[3-9]\d{9}$/.test(phone))return window.SiteMotion?.fieldError('inqPhone','请填写正确的手机号');
  if(content.length<4||content.length>3800)return window.SiteMotion?.fieldError('inqContent','留言须为4至3800字');
  if(!$('#inqConsent')?.checked)return window.SiteMotion?.fieldError('inqConsent','请同意用于本次招商联系');
  await intakeForm(document.querySelector('[data-act="submit:inquiry"]'),async()=>{
    const payload={kind:'inquiry',listing_id:listingId||null,company:State.session.visitor?.company?.name||'个人访客',contact:name,phone,request_text:'【'+type+'】'+content,consent:true,details:{},website:$('#intakeWebsite')?.value||''};
    const delivered=await sendVisitorIntake(payload);
    let visitor=State.session.visitor;
    if(!visitor){visitor={id:uid('V'),nick:name,phone,company:null,needs:[],createdAt:fmtDateTime(new Date()),visits:1};Api.db.visitors.push(visitor);State.session.visitor=visitor;}
    const saved=storeVisitorReceipt(delivered,visitor,payload,type,content);
    delete document.querySelector('[data-act="submit:inquiry"]').dataset.pending;closeSheet();
    window.SiteMotion?.success(saved?'留言已送达，可在「留言咨询」查看处理结果':'留言已送达，但本机记录未保存，请保留联系方式等待顾问联系');setTimeout(refresh,60);
  });
}

let codeTimer = null;
function clearCodeTimer() { if (codeTimer) { clearInterval(codeTimer); codeTimer = null; } }

function startCountdown(btn, sec) {
  if (!btn) return;
  let n = sec;
  clearCodeTimer();
  btn.disabled = true;
  btn.classList.add('disabled');
  btn.textContent = n + ' 秒后重发';
  codeTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearCodeTimer();
      btn.disabled = false;
      btn.classList.remove('disabled');
      btn.textContent = '重新获取';
    } else btn.textContent = n + ' 秒后重发';
  }, 1000);
}

function sendVisitorCode() {
  const phone = (($('#lgPhone') || {}).value || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) { toast('请先填写正确的手机号'); return; }
  const r = Sms.send(phone);
  if (!r.ok) {
    if (r.wait) startCountdown($('#lgSend'), r.wait);
    toast(r.msg);
    return;
  }
  const demo = Sms.conf().demoShow && r.code;
  const hint = $('#lgHint');
  if (hint) {
    hint.innerHTML = `验证码已发送至 ${esc(maskPhone(phone))}，${Math.round(Sms.conf().ttlSec / 60)} 分钟内有效。` +
      (demo ? `<br><b style="color:var(--primary)">演示模式验证码：${r.code}</b>（已自动填入，正式接短信通道后不再显示）` : '');
  }
  if (demo) { const ci = $('#lgCode'); if (ci) ci.value = r.code; }
  toast(demo ? ('验证码已发送（演示：' + r.code + '）') : '验证码已发送，请注意查收');
  startCountdown($('#lgSend'), Sms.conf().cooldownSec);
}

function sheetVisitorLogin() {
  const v = State.session.visitor;
  openSheet(`
    <div class="sheet-head"><h3>客户资料</h3><button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body">
      ${v?.customerCode?`<p class="customer-number">客户编号：${esc(v.customerCode)}</p>`:''}
      <div class="customer-avatar-field"><div class="customer-avatar-preview" id="lgAvatarPreview">${window.SiteCustomer.avatarHTML(v?.avatar,v?.nick)}</div><div><label class="customer-avatar-upload">选择头像<input type="file" id="lgAvatar" accept="image/jpeg,image/png,image/webp"></label><button type="button" class="op-btn" id="lgAvatarRemove">移除头像</button><p id="lgAvatarHint" role="status">选填，自动裁成方形并压缩；保存资料后生效</p></div></div>
      <div class="field"><label>称呼<span class="req">*</span></label><input type="text" id="lgNick" maxlength="40" value="${esc(v ? v.nick : '')}" placeholder="怎么称呼您"></div>
      <div class="field"><label>手机号<span class="req">*</span></label><input type="tel" id="lgPhone" maxlength="11" inputmode="numeric" value="${esc(v ? v.phone : Api.getPhone())}" placeholder="方便招商顾问联系"></div>
      <div class="code-hint">保存后生成固定客户编号，可在本机继续修改。手机号未经身份验证；换设备、清除浏览器数据或清除本机资料后，暂不支持凭手机号找回。</div>
      <label class="customer-consent"><input id="lgConsent" type="checkbox">我同意将称呼、手机号和选填头像保存到招商后台，供招商顾问联系及跟进。</label>
    </div>
    <div class="sheet-foot"><button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button><div class="profile-save-slot"><button class="btn profile-save" type="button" data-act="submit:visitorLogin"><span class="profile-save-label">保存资料</span><span class="profile-save-spinner" aria-hidden="true"></span><svg class="profile-save-check" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></div><div class="profile-save-status sr-only" role="status" aria-live="polite"></div>`);
  window.SiteCustomer.mount(v);
}

async function submitVisitorLogin() {
  const button=document.querySelector('[data-act="submit:visitorLogin"]');
  if(!button||button.disabled)return;
  const phone = (($('#lgPhone') || {}).value || '').trim();
  const nick = (($('#lgNick') || {}).value || '').trim();
  if (!nick) return window.SiteCustomer.fieldError('lgNick','请填写称呼');
  if (!/^1[3-9]\d{9}$/.test(phone)) return window.SiteCustomer.fieldError('lgPhone','请填写正确的手机号');
  if (!$('#lgConsent')?.checked) return window.SiteCustomer.fieldError('lgConsent','请先勾选资料保存及联系说明');
  window.SiteCustomer.clearErrors();
  const saved=await window.SiteCustomer.saveWithFeedback(button,async()=>{
    // Persist the capability before the request. Retries retain the cloud ID,
    // including when the previous response was lost or local storage was full.
    const cloud=await window.SiteCustomer.save(nick,phone,true);
    const v=State.session.visitor?{...State.session.visitor,nick,phone}:{id:uid('V'),nick,phone,company:null,needs:[],createdAt:fmtDateTime(new Date()),visits:1};
    Object.assign(v,cloud);
    // The session is the durable local profile. Write and read it before
    // changing the in-memory identity or reporting a successful save.
    try{Api.setSession({visitor:v,admin:State.session.admin,viewed:State.session.viewed||[]});}catch(_){throw new Error('profile_storage_failed');}
    const stored=Api.getSession().visitor;
    if(stored?.id!==v.id||stored.nick!==nick||stored.phone!==phone)throw new Error('profile_storage_failed');
    State.session.visitor=v;
    const index=Api.db.visitors.findIndex(item=>item.id===v.id);
    if(index<0)Api.db.visitors.push(v);else Api.db.visitors[index]=v;
    Api.setPhone(phone);Api.save();
  });
  if(!saved)return;
  closeSheet(); toast('客户资料已保存'); refresh();
  if (State.pendingInquiry) {
    const pending = State.pendingInquiry; State.pendingInquiry = null;
    setTimeout(() => sheetInquiry(pending.listingId, pending.type, pending), 120);
  }
}

function reloadSession() {
  const s = Api.getSession();
  State.session = { visitor: s.visitor || null, admin: s.admin || null, viewed: s.viewed || [] };
}
function saveSession() {
  Api.setSession({ visitor: State.session.visitor, admin: State.session.admin, viewed: State.session.viewed || [] });
}

/* ---------------- 我的企业 / 我的需求 ----------------
 * Submitted registrations live in the private inquiry inbox. Local profiles,
 * drafts and receipt history belong to this browser; phone input is not login. */
const INDUSTRY_OPTS = ['电子信息', '智能制造', '新材料', '新能源', '生物医药', '软件与信息服务', '数字经济', '现代服务业', '商贸物流', '金融投资', '其他'];
const NEED_TYPE_OPTS = ['办公场地', '研发场地', '厂房', '政策申报', '融资对接', '人才招聘', '供应链资源', '其他'];

/* Session and DB JSON are separate objects after reload. Retain the durable
   session profile if the larger local DB is missing or contains an older copy. */
function curVisitor() {
  const v = State.session.visitor;
  if (!v) return null;
  let rec = Api.db.visitors.find(x => x.id === v.id);
  if(!rec){rec={...v};Api.db.visitors.push(rec);}
  else if(rec!==v){
    const company=(!v.company||new Date(rec.companyAt||0)>new Date(v.companyAt||0))&&rec.company
      ?{company:rec.company,companyReceipt:rec.companyReceipt,companyAt:rec.companyAt}:{};
    Object.assign(rec,v,company);
  }
  if(!rec.company?.name){
    const latest=Api.db.messages.filter(m=>m.visitorId===v.id&&m.kind==='company'&&m.receipt&&m.details?.name)
      .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
    if(latest){rec.company={...latest.details};rec.companyReceipt=latest.receipt;rec.companyAt=latest.createdAt;}
  }
  State.session.visitor = rec;
  return rec;
}

const companyDraftMemory=new Map();
const companyDraftKey=id=>'songshanhu_company_draft_v1:'+id;
function readCompanyDraft(id){
  const drafts=[companyDraftMemory.get(id)];
  for(const storage of ['localStorage','sessionStorage']){
    try{drafts.push(JSON.parse(window[storage].getItem(companyDraftKey(id))||'null'));}catch(_){}
  }
  return drafts.filter(draft=>draft?.visitorId===id&&draft.company&&typeof draft.company==='object')
    .sort((a,b)=>(Number(b.updatedAt)||0)-(Number(a.updatedAt)||0))[0]||null;
}
function saveCompanyDraft(){
  const body=document.querySelector('#sheet [data-company-visitor]');
  if(!body||!$('#sheetMask').classList.contains('show')||$('#sheetMask').classList.contains('closing')||document.querySelector('[data-act="submit:myCompany"]')?.disabled)return;
  const id=body.dataset.companyVisitor;
  const draft={visitorId:id,contact:$('#intakeContact').value,phone:$('#intakePhone').value,
    company:{name:$('#coName').value,industry:$('#coIndustry').value,product:$('#coProduct').value,intro:$('#coIntro').value},updatedAt:Date.now()};
  companyDraftMemory.set(id,draft);
  let durable=false,temporary=false;
  try{const raw=JSON.stringify(draft);localStorage.setItem(companyDraftKey(id),raw);durable=localStorage.getItem(companyDraftKey(id))===raw;}catch(_){}
  if(durable){try{sessionStorage.removeItem(companyDraftKey(id));}catch(_){}}
  else{try{sessionStorage.setItem(companyDraftKey(id),JSON.stringify(draft));temporary=true;}catch(_){}}
  const status=$('#companyDraftStatus');
  if(status){status.textContent=durable?'草稿已保存到此浏览器，尚未提交。':temporary?'草稿仅在当前标签页暂存，请尽快提交；关闭标签页可能丢失。':'此浏览器无法保存草稿，请保持页面打开并提交资料。';status.classList.toggle('storage-warning',!durable);}
}
function clearCompanyDraft(id){
  companyDraftMemory.delete(id);
  for(const storage of ['localStorage','sessionStorage']){try{window[storage].removeItem(companyDraftKey(id));}catch(_){}}
}
document.addEventListener('input',event=>{if(event.target.closest('#sheet [data-company-visitor]')&&event.target.id!=='companyConsent'&&event.target.id!=='intakeWebsite')saveCompanyDraft();});
document.addEventListener('change',event=>{if(event.target.id==='coIndustry')saveCompanyDraft();});
window.addEventListener('pagehide',saveCompanyDraft);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')saveCompanyDraft();});

/* 未登录时弹登录，返回 false 表示流程中断 */
function ensureVisitor() {
  if (curVisitor()) return true;
  toast('请先登录后再填写');
  sheetVisitorLogin();
  return false;
}

function intakeConsentHTML(id) {
  return `<label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.7;margin:12px 0"><input type="checkbox" id="${id}" style="width:18px;height:18px;flex:0 0 18px;margin-top:2px">同意将称呼、手机号及本次填写内容提交至招商后台，仅用于本次联系和跟进。回复在提交时浏览器的「留言咨询」查看；清除浏览器记录后不会按手机号自动恢复。</label><div hidden aria-hidden="true"><label>请留空<input id="intakeWebsite" tabindex="-1" autocomplete="off"></label></div>`;
}
function intakeIdentityHTML(v) {
  return `<div class="field-row"><div class="field"><label>联系人 *</label><input type="text" id="intakeContact" maxlength="40" autocomplete="name" value="${esc(v.nick)}"></div><div class="field"><label>联系电话 *</label><input id="intakePhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="11" value="${esc(v.phone)}"></div></div>`;
}
function sheetMyCompany() {
  const v = curVisitor();
  if (!ensureVisitor()) return;
  const draft=readCompanyDraft(v.id),co=draft?.company||v.company||{};
  openSheet(`
    <div class="sheet-head">
      <h3>我的企业</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body" data-company-visitor="${esc(v.id)}">
      <p class="company-save-status" id="companyDraftStatus" role="status" aria-live="polite">${draft?'已恢复此浏览器的未提交草稿。':v.companyReceipt?'已回填上次提交的企业资料；原登记仍在招商后台。':co.name?'已恢复本机企业资料，提交后招商后台才能收到。':'填写时自动保存本机草稿，点击下方按钮才会提交。'}</p>
      ${intakeIdentityHTML({nick:draft?.contact??v.nick,phone:draft?.phone??v.phone})}
      <div class="field"><label>企业名称<span class="req">*</span></label>
        <input type="text" id="coName" maxlength="40" value="${esc(co.name || '')}" placeholder="请输入企业全称或简称"></div>
      <div class="field"><label>所属行业</label>
        <select id="coIndustry">
          <option value="">请选择行业</option>
          ${INDUSTRY_OPTS.map(o => `<option value="${o}" ${co.industry === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select></div>
      <div class="field"><label>主营产品 / 服务</label>
        <textarea id="coProduct" maxlength="200" placeholder="如：自动化检测设备、企业级 SaaS 软件、精密零部件加工等">${esc(co.product || '')}</textarea></div>
      <div class="field"><label>企业简介</label>
        <textarea id="coIntro" maxlength="500" style="min-height:110px" placeholder="简要介绍企业规模、发展方向、落地需求等，便于招商顾问精准对接">${esc(co.intro || '')}</textarea></div>
      <div style="font-size:11.5px;color:var(--text-3);line-height:1.7;padding-top:6px">
        提交成功后，企业资料会进入管理员后台的「留言 → 企业资料」。修改后再次提交会保留新的登记记录。草稿与回填资料仅保存在此浏览器，换浏览器或清理缓存后不会自动恢复。</div>
      ${intakeConsentHTML('companyConsent')}
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="submit:myCompany">提交企业资料</button>
    </div>`);
}

async function submitMyCompany() {
  const v=curVisitor();if(!v)return toast('请先填写联系资料');
  const company={name:($('#coName')?.value||'').trim(),industry:$('#coIndustry')?.value||'',product:($('#coProduct')?.value||'').trim(),intro:($('#coIntro')?.value||'').trim()};
  if(!company.name)return window.SiteMotion?.fieldError('coName','请填写企业名称');
  if(!$('#companyConsent')?.checked)return window.SiteMotion?.fieldError('companyConsent','请同意用于本次招商联系');
  const contact=($('#intakeContact')?.value||'').trim(),phone=($('#intakePhone')?.value||'').trim();
  if(!contact||contact.length>40)return window.SiteMotion?.fieldError('intakeContact','请填写40字以内联系人');
  if(!/^1[3-9]\d{9}$/.test(phone))return window.SiteMotion?.fieldError('intakePhone','请填写正确的手机号');
  await intakeForm(document.querySelector('[data-act="submit:myCompany"]'),async()=>{
    const content='企业登记：'+company.name;
    const payload={kind:'company',company:company.name,contact,phone,request_text:content,details:company,consent:true,website:$('#intakeWebsite')?.value||''};
    const delivered=await sendVisitorIntake(payload);
    v.nick=contact;v.phone=phone;v.company=company;v.companyReceipt=delivered.receipt;v.companyAt=fmtDateTime(new Date());
    const saved=storeVisitorReceipt(delivered,v,payload,'企业登记',content);
    if(saved)clearCompanyDraft(v.id);
    delete document.querySelector('[data-act="submit:myCompany"]').dataset.pending;closeSheet();
    toast(saved?'企业资料已送达后台，可在留言咨询查看回复':'企业资料已送达，本机记录未保存，请等待顾问联系');setTimeout(refresh,60);
  });
}

function sheetMyNeeds() {
  const v = curVisitor();
  if (!ensureVisitor()) return;
  const needs = v.needs || [];
  openSheet(`
    <div class="sheet-head">
      <h3>我的需求</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      ${intakeIdentityHTML(v)}
      <p style="font-size:12px;color:var(--text-3);line-height:1.7">已送达的需求由招商后台处理；下方旧记录如标注“仅本机”，请确认内容后重新提交。移除本机记录不会撤销后台已收到的登记。</p>
      ${needs.length ? needs.map((n, i) => `
        <div class="menu-item" style="padding:12px 4px">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600">${esc(n.type)} · ${n.receipt ? '已送达后台' : '仅本机，未提交'}${n.at ? `<span style="font-weight:400;color:var(--text-3);font-size:11px;margin-left:8px">${esc(n.at)}</span>` : ''}</div>
            <div style="font-size:12.5px;color:var(--text-2);margin-top:3px;white-space:pre-wrap;word-break:break-all">${esc(n.desc || '')}</div>
          </div>
          <button class="btn sm ghost" style="color:var(--danger);flex:0 0 auto" type="button" data-act="del:myNeed" data-v="${i}">移除本机记录</button>
        </div>`).join('')
      : '<div class="empty">还没有需求记录。填写并提交成功后，招商后台才能收到。</div>'}
      <div style="height:6px"></div>
      <div class="field"><label>需求类型<span class="req">*</span></label>
        <select id="ndType">
          ${NEED_TYPE_OPTS.map(o => `<option value="${o}">${o}</option>`).join('')}
        </select></div>
      <div class="field"><label>需求描述<span class="req">*</span></label>
        <textarea id="ndDesc" maxlength="300" placeholder="如：需要松山湖 200㎡ 左右办公室，可尽快入驻，关注租金补贴政策">${''}</textarea></div>
      ${intakeConsentHTML('needConsent')}
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">关闭</button>
      <button class="btn" type="button" data-act="add:myNeed">提交需求到后台</button>
    </div>`);
}

async function addMyNeed() {
  const v=curVisitor();if(!v)return toast('请先填写联系资料');
  const type=$('#ndType')?.value||'',description=($('#ndDesc')?.value||'').trim();
  const contact=($('#intakeContact')?.value||'').trim(),phone=($('#intakePhone')?.value||'').trim();
  if(!contact||contact.length>40)return window.SiteMotion?.fieldError('intakeContact','请填写40字以内联系人');
  if(!/^1[3-9]\d{9}$/.test(phone))return window.SiteMotion?.fieldError('intakePhone','请填写正确的手机号');
  if(description.length<4||description.length>300)return window.SiteMotion?.fieldError('ndDesc','请填写4至300字需求');
  if(!$('#needConsent')?.checked)return window.SiteMotion?.fieldError('needConsent','请同意用于本次招商联系');
  await intakeForm(document.querySelector('[data-act="add:myNeed"]'),async()=>{
    const content='【'+type+'】'+description;
    const payload={kind:'need',company:v.company?.name||'个人访客',contact,phone,request_text:content,details:{type,description},consent:true,website:$('#intakeWebsite')?.value||''};
    const delivered=await sendVisitorIntake(payload);
    v.needs=v.needs||[];if(!v.needs.some(x=>x.receipt===delivered.receipt))v.needs.push({nid:delivered.id,type,desc:description,at:fmtDateTime(new Date()),receipt:delivered.receipt});
    const saved=storeVisitorReceipt(delivered,v,payload,'选址需求',content);
    delete document.querySelector('[data-act="add:myNeed"]').dataset.pending;closeSheet();
    toast(saved?'需求已送达后台，可在留言咨询查看回复':'需求已送达，本机记录未保存，请等待顾问联系');setTimeout(refresh,60);
  });
}

function delMyNeed(i) {
  const v = curVisitor();
  if (!v) return;
  v.needs = (v.needs || []).filter((_, k) => k !== Number(i));
  Api.save();
  saveSession();
  toast('本机记录已移除，后台登记仍保留');
  refresh();
  sheetMyNeeds();
}

/* ---------------- 管理端动作 ---------------- */
function adminLogin() {
  const u = (($('#admUser') || {}).value || '').trim();
  const p = (($('#admPwd') || {}).value || '').trim();
  if (!u) return toast('请输入管理员账号');
  if (!p) return toast('请输入登录密码');
  const a = Api.db.admins.find(x => x.username === u);
  if (!a || a.password !== p) return toast('账号或密码错误');
  if (!a.enabled) return toast('该账号已被停用');
  a.lastLogin = fmtDateTime(new Date());
  Api.save();
  State.session.admin = { id: a.id, username: a.username, name: a.name, role: a.role };
  saveSession();
  State.adminTab = 'listing';
  toast('登录成功');
  setView('admin', false);
  /* 登录后静默把历史 base64 照片搬到服务器，释放本机空间 */
  migratePhotosToServer().catch(e => console.warn('照片迁移跳过', e));
}

function listingFormHTML(l) {
  const d = l || {
    parkName: parksAll()[0].name, building: '', floor: '', area: '', orientation: OPT_ORIENT[0],
    decoration: '精装修', layout: '3+1', rent: '', propertyFee: '', contact: CONTACTS[0].name,
    phone: CONTACTS[0].phone, address: parksAll()[0].addr, desc: '', status: 'online', usage: '写字楼'
  };
  State.form.photos = (d.photos || []).slice(0, 3);
  State.form.replaceIdx = -1;
  /* 照片是否被本次编辑改动过：没动过就不覆盖云端大图，避免误删照片 */
  State.form.photosTouched = false;
  State.form.editId = l ? l.id : null;
  return `
    <div class="sheet-head">
      <h3>${l ? '编辑房源' : '新增房源'}</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div class="form-title">基础信息</div>
      <div class="field"><label>业态<span class="req">*</span></label>
        <select id="fUsage">
          ${['写字楼', '厂房'].map(o => `<option ${((d.usage || '写字楼')) === o ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>园区名称<span class="req">*</span></label>
        <select id="fPark">
          ${parksAll().map(p => `<option value="${esc(p.name)}" ${d.parkName === p.name ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>楼栋 / 座<span class="req">*</span></label><input type="text" id="fBuilding" value="${esc(d.building)}" placeholder="如 A 栋"></div>
        <div class="field"><label>楼层<span class="req">*</span></label><input type="text" id="fFloor" value="${esc(d.floor)}" placeholder="如 12F/18F"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>面积（㎡）<span class="req">*</span></label><input type="number" id="fArea" value="${esc(d.area)}" placeholder="如 320"></div>
        <div class="field"><label>朝向<span class="req">*</span></label>
          <select id="fOrientation">${OPT_ORIENT.map(o => `<option ${d.orientation === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>装修<span class="req">*</span></label>
          <select id="fDecoration">${OPT_DECO.map(o => `<option ${d.decoration === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>
        <div class="field"><label>格局<span class="req">*</span></label>
          <select id="fLayout">${OPT_LAYOUT.map(o => `<option ${d.layout === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>租金（元/㎡·月）<span class="req">*</span></label><input type="number" id="fRent" value="${esc(d.rent)}" placeholder="如 68"></div>
        <div class="field"><label>物业费（元/㎡·月）<span class="req">*</span></label><input type="number" id="fPropertyFee" value="${esc(d.propertyFee)}" placeholder="如 16"></div>
      </div>
      <div class="field"><label>详细地址</label><input type="text" id="fAddress" value="${esc(d.address)}" placeholder="园区详细地址"></div>
      <div class="field">
        <label>精准定位 <span style="color:var(--text-3);font-weight:400">（在线地图选点，用于地图页房源标记）</span></label>
        <div class="loc-row">
          <input type="text" id="fLatLng" readonly value="${d.lat && d.lng ? (+d.lat).toFixed(6) + ', ' + (+d.lng).toFixed(6) : ''}" placeholder="未定位（可选）">
          <button class="op-btn" type="button" data-act="pick:loc">地图选点</button>
          <button class="op-btn" type="button" data-act="pick:parkLoc">用园区坐标</button>
        </div>
        <input type="hidden" id="fLat" value="${d.lat || ''}">
        <input type="hidden" id="fLng" value="${d.lng || ''}">
        <div class="loc-hint" id="locHint">${d.lat && d.lng ? '已定位，地图页会按此坐标显示该房源标记' : '未定位的房源在地图页按园区大致位置展示'}</div>
      </div>

      <div class="form-title">房源照片（4:3，最多 3 张）</div>
      <div class="upload-grid" id="uploadGrid"></div>
      <input type="file" id="photoInput" accept="image/*" style="display:none">
      <div style="font-size:11px;color:var(--text-3);margin-top:7px;line-height:1.6">
        建议尺寸 1200×900（4:3）。未上传照片时系统自动生成示意图占位。
      </div>

      <div class="form-title">联系方式与介绍</div>
      <div class="field-row">
        <div class="field"><label>联系人<span class="req">*</span></label><input type="text" id="fContact" value="${esc(d.contact)}" placeholder="如 李经理"></div>
        <div class="field"><label>联系电话<span class="req">*</span></label><input type="tel" id="fPhone" value="${esc(d.phone)}" placeholder="手机号"></div>
      </div>
      <div class="field"><label>房源介绍</label><textarea id="fDesc" placeholder="房源亮点、配套、交通、政策等">${esc(d.desc)}</textarea></div>
      <div class="field"><label>推荐标签 <span style="color:var(--text-3);font-weight:400">（人工设置，列表页展示）</span></label>
        <div class="seg" id="fTag">
          ${['', '特价', '热门', '新上'].map(t => `<button type="button" class="${(d.tag || '') === t ? 'on' : ''}" data-v="${t}">${t || '无标签'}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>上架状态</label>
        <div class="seg" id="fStatus">
          <button type="button" class="${d.status === 'online' ? 'on' : ''}" data-v="online">立即上架</button>
          <button type="button" class="${d.status === 'offline' ? 'on' : ''}" data-v="offline">暂不上架</button>
        </div>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="admin:save" data-id="${l ? l.id : ''}">${l ? '保存修改' : '创建房源'}</button>
    </div>`;
}

function bindListingForm() {
  renderUploadGrid();
  const segBind = (sel, def) => {
    const el = $(sel);
    if (el) el.onclick = e => {
      const b = e.target.closest('button');
      if (!b) return;
      $$(sel + ' button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
    };
  };
  segBind('#fStatus');
  segBind('#fTag');
  const inp = $('#photoInput');
  if (inp) inp.onchange = e => { readPhoto(e.target); inp.value = ''; };
}

function renderUploadGrid() {
  const g = $('#uploadGrid');
  if (!g) return;
  const ph = State.form.photos;
  g.innerHTML = ph.map((src, i) => `
    <div class="upload-cell">
      <img src="${photoURL(src)}" alt="">
      <span class="chg" data-act="admin:chgPhoto" data-i="${i}">更换</span>
      <span class="del" data-act="admin:rmPhoto" data-i="${i}">✕</span>
    </div>`).join('') + (ph.length < 3 ? `
    <div class="upload-cell" data-act="admin:addPhoto">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
      添加照片
    </div>` : '');
}

/* 表单里的照片既可能是刚选的 data URL（还没上传），也可能是已上传的服务器地址；
   表单内已有服务器地址时说明本次照片已改动，需要落盘 */
function formHasUploaded() {
  return (State.form.photos || []).some(p => /^\/api\/photo\//.test(p));
}

/* 把表单里的照片提交到服务器独立存储（不再塞进 localStorage，解决手机空间不足） */
async function uploadFormPhotos(listingId) {
  const prev = (findListing(listingId) || {}).photos || [];
  const out = [];
  for (let i = 0; i < State.form.photos.length; i++) {
    const p = State.form.photos[i];
    if (/^\/api\/photo\//.test(p)) { out.push(p); continue; }
    if (!/^data:image\//.test(p)) { out.push(p); continue; }
    try {
      const blob = await (await fetch(p)).blob();
      const r = await fetch('/api/photo/' + encodeURIComponent(listingId) + '/' + i + '?t=' + Date.now(), {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/jpeg' },
        body: blob
      });
      const j = await r.json();
      out.push(j && j.url ? j.url : '');
    } catch (e) {
      console.warn('照片上传失败', e);
      out.push('');
    }
  }
  const clean = out.filter(Boolean);
  /* 全部上传失败时保留原有照片，绝不清空 */
  if (!clean.length && prev.length) return prev.slice(0, 3);
  return clean.slice(0, 3);
}

/* 读取照片：addPhoto 追加，chgPhoto 替换指定位置（第一张即封面）
   压缩后先只留在表单里（data URL），点保存时才上传到服务器 */
function readPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (!/^image\//.test(file.type)) return toast('请选择图片文件');
  const replaceIdx = State.form.replaceIdx;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1200;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      let q = 0.78, out = cv.toDataURL('image/jpeg', q);
      while (out.length > 420000 && q > 0.32) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
      if (replaceIdx >= 0 && replaceIdx < State.form.photos.length) State.form.photos[replaceIdx] = out;
      else State.form.photos.push(out);
      State.form.replaceIdx = -1;
      State.form.photosTouched = true;
      renderUploadGrid();
      toast(replaceIdx >= 0 ? '已更换照片' : '已添加照片');
    };
    img.onerror = () => toast('图片解析失败');
    img.src = reader.result;
  };
  reader.onerror = () => toast('图片读取失败');
  reader.readAsDataURL(file);
}

function saveListing(id) {
  return doSaveListing(id).catch(e => {
    console.warn('保存房源失败', e);
    setSavingPhotos(false);
    toast('保存失败，请重试');
  });
}

/* 保存过程中禁用按钮，避免照片还没传完就重复提交 */
function setSavingPhotos(on) {
  const el = document.querySelector('[data-act="admin:save"]');
  if (!el) return;
  const orig = el.dataset.origText || (el.dataset.origText = el.textContent.trim());
  el.disabled = !!on;
  el.style.opacity = on ? '0.6' : '';
  el.textContent = on ? '上传照片中…' : orig;
}

async function doSaveListing(id) {
  const g = k => { const e = $('#' + k); return e ? e.value.trim() : ''; };
  const parkName = g('fPark'), building = g('fBuilding'), floor = g('fFloor');
  const area = num(g('fArea')), rent = num(g('fRent')), propertyFee = num(g('fPropertyFee'));
  const statusEl = $('#fStatus .on');
  const status = statusEl ? statusEl.dataset.v : 'online';
  const tagEl = $('#fTag .on');
  const tag = tagEl ? (tagEl.dataset.v || '') : '';
  if (!building) return toast('请填写楼栋');
  if (!floor) return toast('请填写楼层');
  if (!area) return toast('请填写面积');
  if (!rent) return toast('请填写租金');
  if (!propertyFee) return toast('请填写物业费');
  const contact = g('fContact'), phone = g('fPhone');
  if (!contact) return toast('请填写联系人');
  if (!/^1[3-9]\d{9}$/.test(phone) && !/^0\d{2,3}-?\d{7,8}$/.test(phone)) return toast('请填写正确的联系电话');

  const park = parksAll().find(p => p.name === parkName) || parksAll()[0];
  const seedIdx = Api.db.listings.length % PHOTO_SETS.length;
  const prev = id ? findListing(id) : null;

  /* 新增房源先定 id，照片才能按 id 存到服务器独立目录 */
  const newId = id || uid('L');
  const touched = State.form.photosTouched;

  /* 照片落盘策略：
     ① 表单里有照片 → 上传到服务器（返回 /api/photo/... 地址），本机只留地址不存 base64
     ② 编辑且表单为空 → 保留原有照片（照片没加载完/被用户清空时绝不用演示图覆盖）
     ③ 新增且没传图 → 用演示图占位（只存短标记，渲染时展开，不占本机空间）
     上传过程失败会返回原有照片，保证不会出现照片被清空的意外 */
  const demoSet = () => PHOTO_SETS[seedIdx].map((t, k) => demoPhoto(t, seedIdx + k));
  let photos, demoPhotos;
  if (State.form.photos.length || touched) {
    if (typeof uploadFormPhotos === 'function') setSavingPhotos(true);
    photos = await uploadFormPhotos(newId).finally(() => setSavingPhotos(false));
    demoPhotos = false;
    if (!photos.length) {
      photos = (prev && (prev.photos || []).length) ? prev.photos.slice(0, 3) : demoSet();
      demoPhotos = !(prev && (prev.photos || []).length);
    }
  } else {
    photos = (prev && (prev.photos || []).length) ? prev.photos.slice(0, 3) : demoSet();
    demoPhotos = !(prev && (prev.photos || []).length);
  }
  /* 表单里的照片如果本身就是演示图（用户没换图），保持演示标记，避免展开成大图存回去 */
  if (!State.form.photosTouched && prev && prev.demoPhotos) { photos = prev.photos.slice(0, 3); demoPhotos = true; }

  const payload = {
    parkName, building, floor, area, rent, propertyFee,
    usage: (g('fUsage') === '厂房' ? '厂房' : '写字楼'),
    orientation: g('fOrientation'), decoration: g('fDecoration'), layout: g('fLayout'),
    address: g('fAddress') || park.addr, contact, phone, desc: g('fDesc'), status, tag, photos,
    demoPhotos,
    /* 照片完整性标记：只有确认手里是完整照片组时才允许覆盖云端照片大图。
       照片已改存服务器，本机不再保留 base64，photosLoaded 仅作历史兼容标记 */
    photosLoaded: id ? (touched || !!(prev && prev.photosLoaded)) : true,
    coord: { x: park.x, y: park.y },
    /* 精准定位（可选）：在线地图选点得到的 GCJ-02 经纬度 */
    lat: round6(num(g('fLat'))), lng: round6(num(g('fLng'))),
    updatedAt: new Date().toISOString()
  };

  if (id) {
    const l = findListing(id);
    if (!l) return toast('房源不存在');
    Object.assign(l, payload);
    Api.save();
    Cloud.pushRow('listings', l);
    toast('房源已保存' + (netOk() ? '，已同步到云端' : '，联网后自动同步'));
  } else {
    const nl = Object.assign({
      id: newId, views: 0, createdAt: new Date().toISOString(),
      __local: true   /* 本机新建：允许回推云端（其他设备的历史缓存不会被回推） */
    }, payload);
    Api.db.listings.unshift(nl);
    Api.save();
    Cloud.pushRow('listings', nl);
    toast('房源创建成功' + (netOk() ? '，已同步到云端' : '，联网后自动同步'));
  }
  closeSheet();
  if (State.view === 'admin') {
    const body = $('#adminBody');
    if (body) body.innerHTML = State.adminTab === 'listing' ? adminListingBody() : renderAdminBody();
  }
  if (State.view === 'home' || State.view === 'map') refresh();
}

function netOk() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

/* ---------------- 房源精准定位（在线地图选点） ----------------
   使用腾讯位置服务 GL JS 选点，得到 GCJ-02 经纬度后存到房源 lat/lng。
   未配置 Key 时不阻断流程，仅提示到后台配置。 */
const PICK = { map: null, marker: null, lat: 0, lng: 0 };

function sheetPickLoc() {
  if (!MapKit.has()) {
    dialog({
      title: '需要先配置在线地图',
      text: '精准定位使用腾讯位置服务在线地图。请到「管理后台 → 登录验证与分享」填入腾讯位置服务 Key（lbs.qq.com 免费申请，并把本站域名加入白名单）。未配置时房源仍按所属园区位置展示，不影响其他功能。',
      okText: '知道了', onOk: () => { }
    });
    return;
  }
  const a = $('#fLat'), b = $('#fLng');
  PICK.lat = a ? num(a.value) : 0;
  PICK.lng = b ? num(b.value) : 0;
  openSheet(`
    <div class="sheet-head">
      <h3>地图选点</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div class="pick-search">
        <input type="text" id="pickKw" placeholder="搜索园区 / 地址，如 光大We谷">
        <button class="op-btn pri" type="button" data-act="pick:search">搜索</button>
      </div>
      <div class="pick-results" id="pickResults"></div>
      <div class="pick-map" id="pickMap"></div>
      <div class="pick-coord" id="pickCoord">${PICK.lat ? PICK.lat.toFixed(6) + ', ' + PICK.lng.toFixed(6) : '点击地图选点'}</div>
      <div class="pick-tip">直接点击底图即可选点；选好后点「使用该位置」保存到本套房源。</div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="pick:ok">使用该位置</button>
    </div>`);
  MapKit.load().then(ok => { if (ok) mountPickMap(); });
}

function mountPickMap() {
  const el = $('#pickMap');
  if (!el) return;
  try {
    const T = MapKit.T;
    const c = MapKit.center();
    const pn = (($('#fPark') || {}).value) || '';
    const p = parksAll().find(x => x.name === pn);
    let fresh = false;
    if (!PICK.lat && p && p.lat && p.lon) { PICK.lat = p.lat; PICK.lng = p.lon; }
    if (!PICK.lat) { PICK.lat = c.lat; PICK.lng = c.lng; fresh = true; }
    const map = new T.Map(el, { center: new T.LatLng(PICK.lat, PICK.lng), zoom: fresh ? 13 : 16 });
    const mk = new T.MultiMarker({
      map,
      styles: { default: new T.MarkerStyle({ width: 30, height: 38 }) },
      geometries: [{ id: 'pick', styleId: 'default', position: new T.LatLng(PICK.lat, PICK.lng) }]
    });
    PICK.map = map; PICK.marker = mk;
    map.on('click', evt => {
      const ll = evt.latLng;
      if (!ll) return;
      setPickPoint(ll.getLat(), ll.getLng());
      try { mk.updateGeometries([{ id: 'pick', styleId: 'default', position: ll }]); } catch (e) { }
    });
  } catch (e) {
    console.warn('选点地图初始化失败', e);
    const el2 = $('#pickMap');
    if (el2) el2.innerHTML = '<div class="pick-err">地图加载失败，请检查 Key 是否已开通「WebServiceAPI / JS API」并加入本站域名白名单</div>';
  }
}

function setPickPoint(lat, lng) {
  PICK.lat = +(+lat).toFixed(6);
  PICK.lng = +(+lng).toFixed(6);
  const c = $('#pickCoord');
  if (c) c.textContent = PICK.lat.toFixed(6) + ', ' + PICK.lng.toFixed(6);
}

function pickSearch() {
  const kwEl = $('#pickKw');
  const kw = kwEl ? kwEl.value.trim() : '';
  const box = $('#pickResults');
  if (!kw) return toast('请输入要搜索的地点');
  const tip = html => { if (box) box.innerHTML = `<div class="pick-err">${html}</div>`; };
  try {
    const T = MapKit.T;
    if (!T || !T.service || !T.service.Suggestion) return tip('当前地图未开通搜索能力，请直接在地图上点选');
    const sug = new T.service.Suggestion({ pageSize: 6, region: '东莞' });
    sug.getSuggestions({ keyword: kw }).then(res => {
      const raw = res && (res.data || res.result || res.pois);
      const list = Array.isArray(raw) ? raw.slice(0, 6) : [];
      if (!list.length) return tip('没有找到「' + esc(kw) + '」，换个关键词或直接点地图选点');
      box.innerHTML = list.map((it, i) => {
        const loc = it.location || it.latLng || {};
        return `<button class="pick-item" type="button" data-act="pick:item" data-lat="${loc.lat || ''}" data-lng="${loc.lng || ''}">
          <b>${esc(it.title || it.name || '')}</b><span>${esc(it.address || '')}</span></button>`;
      }).join('');
    }).catch(() => tip('搜索失败，请直接在地图上点选'));
  } catch (e) {
    tip('搜索不可用，请直接在地图上点选');
  }
}

function pickItem(btn) {
  const lat = num(btn.dataset.lat), lng = num(btn.dataset.lng);
  if (!lat || !lng) return toast('该结果没有坐标，请在地图上点选');
  setPickPoint(lat, lng);
  if (PICK.map) {
    PICK.map.setCenter(new MapKit.T.LatLng(lat, lng));
    PICK.map.setZoom(16);
  }
  try { PICK.marker.updateGeometries([{ id: 'pick', styleId: 'default', position: new MapKit.T.LatLng(lat, lng) }]); } catch (e) { }
}

function applyPickLoc() {
  if (!PICK.lat || !PICK.lng) return toast('请先在地图上选点');
  const a = $('#fLat'), b = $('#fLng'), t = $('#fLatLng'), h = $('#locHint');
  if (a) a.value = String(PICK.lat);
  if (b) b.value = String(PICK.lng);
  if (t) t.value = PICK.lat.toFixed(6) + ', ' + PICK.lng.toFixed(6);
  if (h) h.textContent = '已定位，地图页会按此坐标显示该房源标记';
  closeSheet();
  toast('已记录精准位置');
}

function useParkLoc() {
  const pn = (($('#fPark') || {}).value) || '';
  const p = parksAll().find(x => x.name === pn);
  if (!p || !p.lat || !p.lon) return toast('该园区暂无经纬度，请用「地图选点」手动定位');
  const a = $('#fLat'), b = $('#fLng'), t = $('#fLatLng'), h = $('#locHint');
  if (a) a.value = String(p.lat);
  if (b) b.value = String(p.lon);
  if (t) t.value = (+p.lat).toFixed(6) + ', ' + (+p.lon).toFixed(6);
  if (h) h.textContent = '已按园区坐标定位，可再用「地图选点」精调';
  toast('已填入「' + pn + '」园区坐标');
}

function renderAdminBody() {
  return State.adminTab === 'listing' ? adminListingBody()
    : State.adminTab === 'message' ? adminMessageBody()
      : State.adminTab === 'dashboard' ? adminDashboardBody()
        : State.adminTab === 'map' ? adminMapBody()
          : State.adminTab === 'parks' ? adminParksBody() : adminSystemBody();
}

/* ---------------- 管理后台 · 园区管理 ---------------- */
function adminParksBody() {
  const parks = parksAll();
  return `
  <div class="notice-bar">
    <span>ℹ️</span>
    <span>园区列表会同步到房源表单、地图找房和筛选器。填写经纬度（GCJ-02，如从腾讯地图获取）会自动定位到底图；也可在「地图标注」里拖动微调。</span>
  </div>
  <div class="chart-card" style="margin-top:12px">
    <h3>产业园区 <small>${parks.length} 个</small></h3>
    <div style="margin:0 -14px">
      ${parks.map(p => {
        const cnt = Api.db.listings.filter(l => l.parkName === p.name).length;
        const cc = Api.parkCoord(p.name);
        return `
        <div class="admin-row">
          <div class="admin-avatar" style="background:var(--primary-l);color:var(--primary)">${esc(p.name.replace('松山湖', '').slice(0, 1) || '园')}</div>
          <div class="admin-info">
            <div class="admin-uname">${esc(p.name)}
              <span class="role-chip" style="background:#EEF1F6;color:var(--text-3)">${cnt} 套房源</span>
              ${cc.custom ? '<span class="role-chip">已校准</span>' : (p.precise ? '<span class="role-chip" style="background:var(--success-l);color:var(--success)">精确坐标</span>' : '<span class="role-chip" style="background:#FFF3E4;color:#D97706">估算坐标</span>')}
            </div>
            <div class="admin-meta">${esc(p.addr || '未填地址')}</div>
            <div class="admin-meta">经纬度 ${p.lat && p.lon ? p.lat + ', ' + p.lon : '未填'} · 底图位置 ${cc.x}, ${cc.y}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;flex:0 0 auto">
            <button class="op-btn on" type="button" data-act="admin:editPark" data-v="${esc(p.name)}">编辑</button>
            <button class="op-btn del" type="button" data-act="admin:delPark" data-v="${esc(p.name)}" ${cnt > 0 ? 'disabled style="opacity:.4"' : ''}>删除</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <button class="btn" style="margin-top:14px" type="button" data-act="admin:newPark">+ 新增园区</button>
  </div>
  <div style="height:10px"></div>`;
}

function parkFormSheet(name) {
  const p = name ? Api.park(name) : null;
  openSheet(`
    <div class="sheet-head">
      <h3>${p ? '编辑园区' : '新增园区'}</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div class="field"><label>园区名称<span class="req">*</span></label>
        <input type="text" id="pName" value="${esc(p ? p.name : '')}" placeholder="如 松山湖XX产业园"></div>
      <div class="field"><label>详细地址</label>
        <input type="text" id="pAddr" value="${esc(p ? p.addr : '')}" placeholder="如 松山湖园区XX路X号"></div>
      <div class="field-row">
        <div class="field"><label>纬度</label>
          <input type="text" id="pLat" value="${p && p.lat ? p.lat : ''}" placeholder="22.9xxxxx"></div>
        <div class="field"><label>经度</label>
          <input type="text" id="pLon" value="${p && p.lon ? p.lon : ''}" placeholder="113.8xxxxx"></div>
      </div>
      <div style="font-size:11.5px;color:var(--text-3);line-height:1.7;margin-top:4px">
        经纬度可在腾讯地图（map.qq.com）上右键目标位置获取，坐标系为 GCJ-02。填写后自动定位到底图；不填则默认在图中央，可在「地图标注」里拖动。
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="admin:savePark" data-id="${esc(p ? p.name : '')}">${p ? '保存修改' : '创建园区'}</button>
    </div>`);
}

function saveParkSheet(oldName) {
  const g = k => { const e = $('#' + k); return e ? e.value.trim() : ''; };
  const o = { name: g('pName'), addr: g('pAddr'), lat: g('pLat'), lon: g('pLon') };
  const r = oldName ? Api.updatePark(oldName, o) : Api.addPark(o);
  if (!r.ok) return toast(r.msg);
  closeSheet();
  toast(oldName ? '园区已保存，房源与地图已同步' : '园区已创建');
  State.adminTab = 'parks';
  setView('admin', false);
}

function adminReplySheet(mid) {
  const m = Api.db.messages.find(x => x.id === mid);
  if (!m) return;
  const l = findListing(m.listingId);
  openSheet(`
    <div class="sheet-head">
      <h3>回复访客留言</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div style="background:#F7FAFF;border-radius:10px;padding:11px;font-size:12.5px;line-height:1.7;color:var(--text-2)">
        <b style="color:var(--text)">${esc(m.name)} · ${esc(m.phone)}</b><br>
        ${l ? esc(publicListingTitle(l)) : '房源已删除'} · ${esc(m.createdAt)}<br>
        <span style="color:var(--text)">【${esc(m.type)}】${esc(m.content)}</span>
      </div>
      <div class="field"><label>回复内容<span class="req">*</span></label>
        <textarea id="replyText" placeholder="请输入回复内容">${esc(m.reply || '')}</textarea></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${['您好，房源仍在租，可以安排带看，请问您方便的时间？',
      '已为您预留房源，稍后招商顾问将电话与您确认细节。',
      '该房源支持分租，具体价格可根据租赁年限协商。'].map(t =>
        `<button class="op-btn" type="button" data-act="reply:quick" data-v="${esc(t)}">快捷语</button>`).join('')}
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="admin:doReply" data-id="${mid}">发送回复</button>
    </div>`);
  const box = $('#replyText');
  if (box) box.focus();
}

function newAdminSheet() {
  const db = Api.db;
  if (db.admins.length >= db.settings.maxAdmins) {
    return dialog({
      title: '已达管理员上限',
      text: `当前管理员数量已达上限 ${db.settings.maxAdmins} 人，请先在「设置」中调整上限或删除已有管理员账号。`,
      cancelText: ''
    });
  }
  openSheet(`
    <div class="sheet-head"><h3>新增管理员</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body">
      <div class="field"><label>姓名 / 备注<span class="req">*</span></label><input type="text" id="naName" placeholder="如 招商部 · 黄小姐"></div>
      <div class="field"><label>登录账号<span class="req">*</span></label><input type="text" id="naUser" placeholder="英文或数字，用于登录"></div>
      <div class="field"><label>登录密码<span class="req">*</span></label><input type="text" id="naPwd" placeholder="至少 6 位，创建后可在后台修改" autocomplete="new-password"></div>
      <div class="field"><label>手机号</label><input type="tel" id="naPhone" placeholder="选填"></div>
      <div class="notice-bar" style="margin:8px 0 0">
        <span>ℹ️</span><span>新增管理员拥有房源上下架与留言处理权限，但不能管理其他管理员账号。上限 ${db.settings.maxAdmins} 人，当前 ${db.admins.length} 人。</span>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="admin:doNewAdmin">创建账号</button>
    </div>`);
}

function sheetResetPwd(id) {
  const a = Api.db.admins.find(x => x.id === id);
  if (!a) return toast('账号不存在');
  openSheet(`
    <div class="sheet-head"><h3>修改密码 · ${esc(a.name)}</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body">
      <div class="field"><label>新密码<span class="req">*</span></label><input type="password" id="rpPwd" placeholder="至少 6 位" autocomplete="new-password"></div>
      <div class="field"><label>确认新密码<span class="req">*</span></label><input type="password" id="rpPwd2" placeholder="再输入一次" autocomplete="new-password"></div>
      <div class="notice-bar" style="margin:8px 0 0"><span>ℹ️</span><span>修改后该账号下次登录需使用新密码。</span></div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="close:sheet">取消</button>
      <button class="btn" type="button" data-act="admin:doResetPwd" data-id="${id}">确认修改</button>
    </div>`);
}

function doResetPwd(id) {
  const p = (($('#rpPwd') || {}).value || '').trim();
  const p2 = (($('#rpPwd2') || {}).value || '').trim();
  if (p.length < 6) return toast('密码至少 6 位');
  if (p !== p2) return toast('两次输入的密码不一致');
  const a = Api.db.admins.find(x => x.id === id);
  if (!a) return toast('账号不存在');
  a.password = p;
  Api.save();
  /* 记入待同步并立即上云：管理员账号原来只存本机，会被其他设备的旧设置覆盖 */
  Cloud.markDirty('admins', a.id);
  Cloud.pushAdmins();
  closeSheet();
  toast('密码已更新，请妥善保管');
}

function doNewAdmin() {
  const db = Api.db;
  const name = (($('#naName') || {}).value || '').trim();
  const username = (($('#naUser') || {}).value || '').trim();
  const password = (($('#naPwd') || {}).value || '').trim();
  const phone = (($('#naPhone') || {}).value || '').trim();
  if (!name) return toast('请填写姓名 / 备注');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return toast('账号需为 3-16 位英文、数字或下划线');
  if (password.length < 6) return toast('密码至少 6 位');
  if (db.admins.some(a => a.username === username)) return toast('该账号已存在');
  if (db.admins.length >= db.settings.maxAdmins) return toast('已达管理员数量上限');
  db.admins.push({
    id: uid('A'), username, password, name, phone, role: 'admin', enabled: true,
    createdAt: fmtDateTime(new Date()), lastLogin: ''
  });
  Api.save();
  /* 新账号要同步到云端，否则任何一次合并都会把它冲掉（其他设备登录也看不到） */
  Cloud.markDirty('admins', db.admins[db.admins.length - 1].id);
  Cloud.pushAdmins();
  closeSheet();
  toast('管理员「' + name + '」创建成功');
  const body = $('#adminBody');
  if (body) body.innerHTML = renderAdminBody();
}

/* ---------------- CSV 导出 ---------------- */
function downloadCSV(filename, rows) {
  const csv = '\ufeff' + rows.map(r => r.map(c => {
    const s = String(c == null ? '' : c).replace(/"/g, '""');
    return /[",\n]/.test(s) ? '"' + s + '"' : s;
  }).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
  toast('已导出 ' + filename);
}

function exportListings() {
  const rows = [['房源编号', '园区名称', '楼栋', '楼层', '面积(㎡)', '朝向', '装修', '格局', '租金(元/㎡·月)', '物业费(元/㎡·月)', '状态', '浏览量', '联系人', '联系电话', '挂牌时间']];
  Api.db.listings.forEach(l => rows.push([l.id, l.parkName, l.building, l.floor, l.area, l.orientation,
    l.decoration, l.layout, l.rent, l.propertyFee, l.status === 'online' ? '在租' : '已下架',
    l.views, l.contact, l.phone, fmtDate(new Date(l.createdAt))]));
  downloadCSV('松山湖房源清单_' + today() + '.csv', rows);
}

function exportVisitors() {
  const rows = [['留言编号', '称呼', '手机号', '咨询类型', '关联房源', '留言内容', '留言时间', '处理状态', '回复内容']];
  Api.db.messages.forEach(m => {
    const l = findListing(m.listingId);
    rows.push([m.id, m.name, m.phone, m.type, l ? publicListingTitle(l) : '已删除',
      m.content, m.createdAt, m.status === 'pending' ? '待回复' : '已回复', m.reply || '']);
  });
  rows.push([]);
  rows.push(['登记访客', '称呼', '手机号', '首次访问时间', '访问次数']);
  Api.db.visitors.forEach(v => rows.push([v.id, v.nick, v.phone, v.createdAt, v.visits || 1]));
  rows.push([]);
  rows.push(['近 7 日访客趋势', '日期', '访客数']);
  Api.db.visitLog.slice(-7).forEach(v => rows.push(['', v.d, v.v]));
  rows.push([]);
  rows.push(['汇总', '累计访客', Api.db.stats.visitors, '累计浏览', Api.db.stats.views,
    '房源总数', Api.db.listings.length, '留言总数', Api.db.messages.length]);
  downloadCSV('松山湖访客与留言数据_' + today() + '.csv', rows);
}

/* ---------------- 弹层选择器 ---------------- */
function sheetFilter() {
  const f = State.filterDraft = {...State.filters};
  const chipRow = (key, opts, labelMap) => `
    <div class="field"><label>${labelMap}</label>
      <div class="seg" data-filter="${key}">
        ${opts.map(o => `<button type="button" class="${f[key] === o ? 'on' : ''}" data-v="${esc(o)}">${esc(o === '全部' ? '不限' : ['area','rent'].includes(key)?rangeLabel(o,key):o)}</button>`).join('')}
      </div>
    </div>`;
  openSheet(`
    <div class="sheet-head"><h3>筛选房源</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body">
      <p class="filter-explainer">可组合选择多个条件，点击下方“查看房源”后生效。</p>
      ${chipRow('usage', ['全部','写字楼','厂房','研发办公','仓储'], '房源类型')}
      <div class="field"><label>所属片区</label>
        <div class="seg" data-filter="park">
          ${['全部'].concat(PUBLIC_REGIONS).map(o =>
    `<button type="button" class="${f.park === o ? 'on' : ''}" data-v="${esc(o)}">${esc(o === '全部' ? '不限' : o)}</button>`).join('')}
        </div>
      </div>
      ${chipRow('rent', RENT_OPTS, '租金单价（元/㎡·月，不含物业费）')}
      ${chipRow('area', AREA_OPTS, '面积区间（㎡）')}
      ${chipRow('orientation', ['全部'].concat(OPT_ORIENT), '朝向')}
      ${chipRow('decoration', ['全部'].concat(OPT_DECO), '装修')}
      ${chipRow('layout', ['全部'].concat(OPT_LAYOUT), '格局')}
      <div class="field"><label>排序</label>
        <div class="seg" data-filter="sort">
          ${SORT_OPTS.map(s => `<button type="button" class="${f.sort === s.k ? 'on' : ''}" data-v="${s.k}">${s.t}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" style="flex:0 0 96px" type="button" data-act="filters:reset">重置</button>
      <button class="btn" type="button" data-act="filters:apply">查看 ${applyFilters(onlineListings(),f).length} 套房源</button>
    </div>`);
}

function sheetSinglePicker(key, opts, title) {
  const f = State.filterDraft = {...State.filters};
  openSheet(`
    <div class="sheet-head"><h3>${esc(title)}</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body">
      <div class="seg" data-filter="${key}">
        ${opts.map(o => `<button type="button" class="${f[key] === o ? 'on' : ''}" data-v="${esc(o)}">${esc(o === '全部' ? '不限' : ['area','rent'].includes(key)?rangeLabel(o,key):o)}</button>`).join('')}
      </div>
      ${key==='rent'?'<p class="filter-explainer">这里选择每平方米每月的租金单价，不含物业费。按整套月租找房，可在搜索中输入“月租不超过10000元”。</p>':''}
    </div>
    <div class="sheet-foot"><button class="btn" type="button" data-act="filters:apply">查看 ${applyFilters(onlineListings(),f).length} 套房源</button></div>`);
}

function sheetViewed() {
  const ids = State.session.viewed || [];
  const list = ids.map(findListing).filter(Boolean);
  openSheet(`
    <div class="sheet-head"><h3>浏览记录</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body">
      ${list.length ? list.map(l => `
        <div style="display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)" data-act="open:listing" data-id="${l.id}">
          <img src="${photoURL(l.photos && l.photos[0])}" style="width:70px;height:53px;object-fit:cover;border-radius:8px;flex:0 0 70px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(publicListingTitle(l))}</div>
            <div style="font-size:11.5px;color:var(--text-3);margin-top:4px">${l.area}㎡ · ${esc(l.layout)} · ${l.rent} 元/㎡·月</div>
          </div>
        </div>`).join('') : '<div class="empty">暂无浏览记录</div>'}
    </div>`);
}

function sheetSettings() {
  openSheet(`
    <div class="sheet-head"><h3>设置</h3>
      <button class="sheet-close" type="button" aria-label="关闭设置" data-act="close:sheet">✕</button></div>
    <div class="sheet-body" style="padding-bottom:18px">
      <button class="menu-item" type="button" data-act="open:adminLogin" style="width:100%;border:0;background:transparent;text-align:left;font:inherit;color:inherit">
        <div class="menu-ico" style="background:#FFF3E4;color:#D97706">🔐</div>
        <div class="mi-text">管理员后台</div><div class="mi-arrow">›</div>
      </button>
      <p style="font-size:12px;color:var(--text-3);line-height:1.7;margin-top:12px">仅已授权的管理账号可进入，使用本站管理员邮箱和密码登录。</p>
    </div>`);
}

function sheetAbout() {
  openSheet(`
    <div class="sheet-head"><h3>关于平台</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button></div>
    <div class="sheet-body" style="padding-bottom:18px">
      <div style="background:linear-gradient(135deg,#1677FF,#4FA4FF);border-radius:12px;padding:16px;color:#fff">
        <div style="font-size:17px;font-weight:700">松山湖产业招商</div>
        <div style="font-size:12px;opacity:.9;margin-top:6px;line-height:1.7">
          覆盖松山湖高新区 12 个重点产业园，提供房源展示、在线咨询、预约看房与招商数据管理服务。
        </div>
      </div>
      <div style="font-size:13px;color:var(--text-2);line-height:2;margin-top:14px">
        <div>招商热线：${esc(Api.db.settings.hotline)}</div>
        <div>服务时间：周一至周六 9:00 - 18:00</div>
        <div>入驻服务：工商注册 · 政策申报 · 装修设计 · 人才招聘</div>
        <div style="margin-top:10px;font-size:11.5px;color:var(--text-3)">
          房源与访客数据已接入云端数据库，多设备实时同步。
        </div>
        <div style="margin-top:6px;font-size:11.5px;color:var(--text-3)">
          版本 v${APP_VER}${Cloud.ready ? ' · 云端已连接' : ' · 本地模式'} · 升级版本不改动房源/管理员等已有数据
        </div>
      </div>
    </div>`);
}

/* ============================================================
 * 微信分享 / 转发
 * ------------------------------------------------------------
 * 纯 H5 无法直接调起微信转发（需公众号 JS-SDK 且域名通过校验），
 * 因此这里提供三条可用路径：
 *   1) 复制带参数的链接（好友点开直接落到对应房源/园区）
 *   2) 生成分享海报（含二维码，长按即可发送给微信好友）
 *   3) 微信内右上角「···」引导层
 * 若已配置公众号 appId，WxShare.setup() 会自动接入原生分享。
 * ============================================================ */
const IS_WECHAT = /MicroMessenger/i.test(navigator.userAgent);
const IS_QQ = /\sQQ/i.test(navigator.userAgent) || /QQBrowser/i.test(navigator.userAgent);
/* 每次发布递增：分享链接自动带上 v=APP_VER，URL 变化可击穿微信 webview 的页面缓存 */
const APP_VER = '20261019k';

/* 唯一可信的分享域名。
 * 背景：曾用 location.origin 动态取域名，若页面从旧入口/失效域名打开，
 * 海报二维码和分享卡片就会编码成死链（扫码显示"链接已失效"）。
 * 现固定为正式发布域名：无论从哪个入口打开，分享出去的链接全部落在这里。 */
const SHARE_BASE = new URL('.', location.href).href.replace(/\/$/, '');

function shareLink(params) {
  const base = SHARE_BASE + '/';
  const p = Object.assign({ v: APP_VER }, params || {});
  const q = Object.keys(p)
    .filter(k => p[k] !== undefined && p[k] !== null && p[k] !== '')
    .map(k => k + '=' + encodeURIComponent(p[k])).join('&');
  return base + '?' + q;
}

function copyText(txt) {
  return new Promise(resolve => {
    const fb = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        resolve(ok);
      } catch (e) { resolve(false); }
    };
    if (navigator.clipboard && /^https?:/.test(location.protocol)) {
      navigator.clipboard.writeText(txt).then(() => resolve(true)).catch(fb);
    } else fb();
  });
}

/* ---------- 二维码 ---------- */
/* 内部 3 倍超采样渲染 + 整数模块尺寸：手机高分屏下二维码清晰、模块不粘连，扫码成功率高 */
function qrCanvas(text, size) {
  const SS = 3;
  const px = Math.round(size * SS);
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, px, px);
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const pad = Math.round(px * 0.06);
    const cell = Math.max(1, Math.floor((px - pad * 2) / n));
    const off = Math.round((px - cell * n) / 2);
    g.fillStyle = '#16202E';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) g.fillRect(off + c * cell, off + r * cell, cell, cell);
      }
    }
  } catch (e) { console.warn('二维码生成失败', e); }
  return cv;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

const FONT = '"PingFang SC","Microsoft YaHei",sans-serif';
function fitText(g, text, maxW, base) {
  let s = base;
  while (s > 12) {
    g.font = `600 ${s}px ${FONT}`;
    if (g.measureText(text).width <= maxW) break;
    s -= 2;
  }
  return s;
}

function drawCover(g, im, x, y, w, h) {
  g.save();
  roundRect(g, x, y, w, h, 14); g.clip();
  if (!im || !im.width) {
    g.fillStyle = '#DCE6F2'; g.fillRect(x, y, w, h);
  } else {
    const s = Math.max(w / im.width, h / im.height);
    const dw = im.width * s, dh = im.height * s;
    g.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  g.restore();
}

/* 生成分享海报（返回 dataURL） */
/* 海报缓存：保存图片时用 canvas 原件生成 Blob，避免超长 data URL 被浏览器/微信拦截 */
const POSTER = { cv: null, blobUrl: null, file: null, generation: 0, busy: false };

function revokePosterBlob() {
  try { if (POSTER.blobUrl) { URL.revokeObjectURL(POSTER.blobUrl); POSTER.blobUrl = null; } } catch (e) { }
}

function buildPoster(kind, l, done) {
  const W = 750, H = kind === 'site' ? 1240 : 1210;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#EEF3F9'; g.fillRect(0, 0, W, H);
  roundRect(g, 22, 22, W - 44, H - 44, 26);
  g.fillStyle = '#fff'; g.fill();

  const url = kind === 'site' ? shareLink({ src: 'poster' }) : shareLink({ id: l.id, src: 'poster' });
  const coverSmall = kind === 'site'
    ? 'assets/site-poster-cover-20261025.jpg'
    : photoURL((l.photos && l.photos[0]) || photoURI('facade', 0));

  const img = new Image();
  let called = false;
  function finish() {
    if (called) return; called = true;
    const im = img.complete && img.naturalWidth ? img : null;
    // 封面
    drawCover(g, im, 44, 44, W - 88, 430);

    if (kind === 'site') {
      const st = Api.db.settings.share || {};
      g.fillStyle = '#16202E';
      g.font = `700 ${fitText(g, st.title || '松山湖产业招商', W - 130, 40)}px ${FONT}`;
      g.fillText(st.title || '松山湖产业招商', 56, 540);
      g.fillStyle = '#6B7A8D';
      g.font = `400 24px ${FONT}`;
      g.fillText(st.desc || '写字楼 / 厂房实盘 · 在线选址咨询', 56, 582);
    } else {
      g.fillStyle = '#16202E';
      const t = publicListingTitle(l);
      g.font = `700 ${fitText(g, t, W - 130, 38)}px ${FONT}`;
      g.fillText(t, 56, 542);
      g.fillStyle = '#E8542B';
      g.font = `700 46px ${FONT}`;
      const priceLabel = l.rent==null?'面议':String(l.rent);
      g.fillText(priceLabel, 56, 604);
      g.fillStyle = '#16202E';
      g.font = `400 22px ${FONT}`;
      if(l.rent!=null)g.fillText('元/㎡·月', 56 + g.measureText(priceLabel).width + 82, 602);
      g.fillStyle = '#6B7A8D';
      g.font = `400 22px ${FONT}`;
      const posterCosts = window.SiteFees.calculate(l.area,l.rent,l.propertyFee);
      const posterMoney = cents => cents===null?'待确认':window.SiteFees.formatCents(cents)+'元';
      const feeLine = `月租金 ${posterMoney(posterCosts.rentCents)} · 月物业 ${posterMoney(posterCosts.feeCents)}`;
      g.font = `400 ${fitText(g,feeLine,W-130,22)}px ${FONT}`;
      g.fillText(feeLine,56,641);
      g.font = `400 22px ${FONT}`;
      g.fillText(`两项每月合计 ${posterMoney(posterCosts.totalCents)}`,56,674);
    }

    // 参数区
    const items = kind === 'site'
      ? [['覆盖片区', new Set(Api.db.listings.map(x => x.parkName)).size + ' 个'], ['在租房源', Api.db.listings.filter(x => x.status === 'online').length + ' 套'],
      ['可租面积', Api.db.listings.filter(x=>x.status==='online'&&x.area>0).map(x=>x.area).length ? (()=>{const a=Api.db.listings.filter(x=>x.status==='online'&&x.area>0).map(x=>x.area);return Math.min(...a)===Math.max(...a)?a[0]+'㎡':Math.min(...a)+'–'+Math.max(...a)+'㎡';})() : '待咨询'], ['招商热线', Api.db.settings.hotline || '在线留言咨询']]
      : [['楼层', l.floor], ['面积', l.area + ' ㎡'], ['朝向', l.orientation],
      ['装修', l.decoration], ['格局', l.layout], ['物业费', l.propertyFee==null?'待确认':l.propertyFee + ' 元/㎡·月']];
    const gy = kind === 'site' ? 640 : 700;
    items.forEach((it, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const bx = 56 + col * 320, by = gy + row * 78;
      g.fillStyle = '#F4F7FB';
      roundRect(g, bx, by, 300, 62, 12); g.fill();
      g.fillStyle = '#8794A6'; g.font = `400 21px ${FONT}`;
      g.fillText(it[0], bx + 18, by + 26);
      g.fillStyle = '#16202E'; g.font = `600 ${fitText(g, String(it[1]), 170, 24)}px ${FONT}`;
      g.fillText(String(it[1]), bx + 18, by + 52);
    });

    const qy = kind === 'site' ? 1000 : 966;
    // 分割线
    g.strokeStyle = '#E7ECF3'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(56, qy - 34); g.lineTo(W - 56, qy - 34); g.stroke();

    // 二维码（放大到 190，手机端更易识别）
    const qs = 190;
    const qc = qrCanvas(url, qs);
    g.drawImage(qc, 56, qy - 12, qs, qs);
    g.fillStyle = '#16202E'; g.font = `600 27px ${FONT}`;
    g.fillText(kind === 'site' ? '扫码查看招商网站' : '长按识别 · 查看房源详情', 268, qy + 52);
    g.fillStyle = '#8794A6'; g.font = `400 22px ${FONT}`;
    g.fillText(kind === 'site'
      ? '看园区地图 · 查在租房源 · 留言咨询'
      : (publicListingTitle(l) + ' ' + l.floor), 268, qy + 88);
    g.fillText('招商顾问：' + (kind === 'site' ? (Api.db.settings.hotline || '扫码在线咨询') : l.contact + ' ' + (l.phone || '扫码在线咨询')), 268, qy + 126);

    g.fillStyle = '#B7C2D0'; g.font = `400 20px ${FONT}`;
    g.fillText(Api.db.settings.siteName + ' · 本信息由招商方发布', 56, H - 48);

    POSTER.cv = cv;
    let out = '';
    try {
      out = cv.toDataURL('image/jpeg', 0.92);
    } catch (e) {
      // 画布被跨域图片污染时的降级：不再带封面，只保留文字与二维码
      try {
        const c2 = document.createElement('canvas');
        c2.width = W; c2.height = H;
        const g2 = c2.getContext('2d');
        g2.fillStyle = '#fff'; g2.fillRect(0, 0, W, H);
        g2.fillStyle = '#16202E'; g2.font = `700 40px ${FONT}`;
        g2.fillText(kind === 'site' ? '松山湖产业招商' : (publicListingTitle(l)), 56, 120);
        g2.drawImage(qrCanvas(url, 200), 56, 200, 200, 200);
        POSTER.cv = c2;
        out = c2.toDataURL('image/jpeg', 0.92);
      } catch (e2) { out = ''; }
    }
    done(out);
  }

  img.onload = finish;
  img.onerror = finish;
  img.crossOrigin = 'anonymous';
  img.src = coverSmall;
}

function posterCanShareFile() {
  try{return !!(POSTER.file && navigator.share && navigator.canShare?.({files:[POSTER.file]}));}catch(_){return false;}
}
function posterSaveHint(text) {
  const tip=document.querySelector('#posterMask .poster-tip');if(tip)tip.textContent=text;
}
function openPoster(dataUrl) {
  if(!dataUrl){toast('海报生成失败，请改用复制链接分享');return;}
  const generation=++POSTER.generation;
  revokePosterBlob();POSTER.file=null;POSTER.busy=false;
  const image=$('#posterImg'),button=$('#posterSave'),original=$('#posterOriginal');
  image.src=dataUrl;button.disabled=true;button.textContent='正在准备图片…';original.hidden=true;original.removeAttribute('href');
  $('#posterMask').classList.add('show');
  posterSaveHint('正在准备可保存的原图…');
  // Prepare the actual File before the next click so iOS keeps the user gesture for native sharing.
  const finish=blob=>{
    if(generation!==POSTER.generation)return;
    if(!blob){button.disabled=true;button.textContent='图片准备失败';posterSaveHint('请关闭后重新生成，或改用复制链接。');return;}
    POSTER.blobUrl=URL.createObjectURL(blob);POSTER.file=new File([blob],'松山湖产业招商_'+Date.now()+'.jpg',{type:'image/jpeg'});
    image.src=POSTER.blobUrl;original.href=POSTER.blobUrl;original.hidden=false;button.disabled=false;
    const mobile=/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
    button.textContent=posterCanShareFile()&&mobile?'分享／保存图片':mobile?'打开原图保存':'下载图片';
    posterSaveHint(mobile?'可长按海报尝试保存，或点按钮打开系统分享／原图。若内置浏览器没有保存菜单，请在 Safari 或系统浏览器打开本网页。':'点击下载图片；也可以打开原图后右键另存为。');
  };
  try{POSTER.cv.toBlob(finish,'image/jpeg',0.92);}catch(_){finish(null);}
}
function closePoster() {
  $('#posterMask')?.classList.remove('show');
  POSTER.generation++;POSTER.file=null;POSTER.busy=false;
  // A newly opened image tab may still be reading this URL. Keep it alive briefly.
  const url=POSTER.blobUrl;POSTER.blobUrl=null;if(url)setTimeout(()=>URL.revokeObjectURL(url),300000);
}
function openPosterOriginal() {
  const original=$('#posterOriginal');
  if(!original?.href||original.hidden){toast('原图正在准备，请稍后重试');return;}
  original.click();
  posterSaveHint('已请求打开原图。长按图片选择保存；若没有打开，请直接点“打开原图”，或在 Safari／系统浏览器打开本网页。');
}
function savePoster() {
  if(!POSTER.file||!POSTER.blobUrl){toast('原图正在准备，请稍后重试');return;}
  if(POSTER.busy)return;
  const mobile=/iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
  if(mobile&&posterCanShareFile()){
    POSTER.busy=true;
    // Do not await any conversion or network operation before this call.
    navigator.share({files:[POSTER.file],title:'松山湖产业招商海报'}).then(()=>{
      posterSaveHint('系统分享操作已完成；图片是否存入相册，请以系统中的操作结果为准。');
    }).catch(error=>{
      if(error.name==='AbortError'){posterSaveHint('已取消分享，可再次点击按钮或打开原图保存。');return;}
      posterSaveHint('此浏览器未能打开图片分享。请点“打开原图”后长按保存；仍无菜单时，在 Safari／系统浏览器打开本网页。');
    }).finally(()=>{POSTER.busy=false;});
    return;
  }
  if(mobile||IS_WECHAT||IS_QQ){openPosterOriginal();return;}
  const anchor=document.createElement('a');anchor.href=POSTER.blobUrl;anchor.download=POSTER.file.name;anchor.rel='noopener';document.body.appendChild(anchor);anchor.click();anchor.remove();
  posterSaveHint('已发起图片下载，请查看浏览器的下载记录；也可打开原图后右键另存为。');
}

/* ---------- 分享面板 ---------- */
function shareCtx(kind, id) {
  if (kind === 'listing') {
    const l = findListing(id);
    if (!l) return null;
    return {
      kind, l,
      title: `${publicListingTitle(l)} ${l.area}㎡ ${l.rent==null?'租金面议':l.rent+'元/㎡·月'}`,
      desc: `${l.floor} · ${l.orientation}向 · ${l.decoration} · ${l.layout}，物业费 ${l.propertyFee} 元/㎡·月`,
      url: shareLink({ id: l.id }),
      /* 卡片缩略图：服务端把该房源首图转成公网图片（微信要求 http(s) 地址） */
      imgUrl: (l.photos || [])[0] || SHARE_BASE + '/assets/songshanhu-map.jpg'
    };
  }
  return {
    kind: 'site',
    l: null,
    title: (Api.db.settings.share && Api.db.settings.share.title) || '松山湖产业招商网站',
    desc: (Api.db.settings.share && Api.db.settings.share.desc) || '房源筛选、在线留言，招商顾问一对一对接',
    url: shareLink({}),
    imgUrl: ''
  };
}

function sheetShare(kind, id) {
  const c = shareCtx(kind, id);
  if (!c) return toast('房源不存在');
  State.share = c;
  openSheet(`
    <div class="sheet-head">
      <h3>分享转发</h3>
      <button class="sheet-close" type="button" data-act="close:sheet">✕</button>
    </div>
    <div class="sheet-body">
      <div class="share-card">
        <div class="share-thumb">${c.kind === 'site'
      ? '<span class="share-site-symbol" aria-hidden="true">登来</span>'
      : `<img src="${photoURL((c.l.photos && c.l.photos[0]) || photoURI('facade', 0))}" alt="">`}</div>
        <div class="share-meta">
          <div class="share-title">${esc(c.title)}</div>
          <div class="share-desc">${esc(c.desc)}</div>
        </div>
      </div>

      <div class="share-grid">
        <button class="share-btn" type="button" data-act="share:wx">
          <span class="sb-ico wx"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4C5.1 4 2 6.6 2 9.8c0 1.8 1 3.4 2.6 4.5l-.7 2.1 2.4-1.2c.9.3 1.8.4 2.7.4h.6a5.9 5.9 0 01-.2-1.5C9.4 10.7 12.6 8 16.7 8h.7C16.8 5.7 13.2 4 9 4z"/><path d="M22 14.2c0-2.7-2.6-4.9-5.8-4.9s-5.8 2.2-5.8 4.9 2.6 4.9 5.8 4.9c.7 0 1.4-.1 2-.3l1.9 1-.5-1.7c1.5-.9 2.4-2.2 2.4-3.9z"/></svg></span>
          <span class="sb-t">微信好友</span>
        </button>
        <button class="share-btn" type="button" data-act="share:copy">
          <span class="sb-ico link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/></svg></span>
          <span class="sb-t">复制链接</span>
        </button>
        <button class="share-btn" type="button" data-act="share:poster">
          <span class="sb-ico poster"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 15l3-3 3 3 2-2 3 3"/><circle cx="8.5" cy="8.5" r="1.5"/></svg></span>
          <span class="sb-t">分享海报</span>
        </button>
        <button class="share-btn" type="button" data-act="share:more">
          <span class="sb-ico more"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></span>
          <span class="sb-t">更多方式</span>
        </button>
      </div>

      <div class="share-link-row">
        <input type="text" id="shareUrlBox" readonly value="${esc(c.url)}">
        <button class="op-btn pri" type="button" data-act="share:copy">复制</button>
      </div>
      <div class="share-tip">
        ${IS_WECHAT
      ? '可通过微信右上角 <b>···</b> 选择「发送给朋友」，或复制链接、保存海报后发送。'
      : '复制链接后可粘贴到微信或 QQ，好友打开即可查看房源详情；也可以生成分享海报。'}
      </div>
    </div>
    <div class="sheet-foot">
      <button class="btn gray" type="button" data-act="close:sheet">关闭</button>
    </div>`);
}

/* 未配置公众号时的原生转发：WeixinJSBridge 直接唤起微信转发面板（无需 JS-SDK 签名）。
   仅在微信 webview 中可用；返回 false 或通道报错时调用方回退到右上角引导。 */
function wxBridgeShare(c) {
  try {
    const B = window.WeixinJSBridge;
    if (!B || typeof B.invoke !== 'function') return false;
    let img = '';
    const p = c.imgUrl || (c.l && c.l.photos && c.l.photos[0]) || '';
    if (/^https?:/i.test(p)) img = p;
    else if (p && p.indexOf('data:') !== 0) img = SHARE_BASE + '/' + String(p).replace(/^\.\//, '');
    B.invoke('sendAppMessage', {
      appid: '', type: 'link',
      title: c.title, desc: c.desc, link: c.url, img_url: img
    }, function (res) {
      /* 新版本微信已弃用该 bridge 方法：报错时回退到右上角引导，避免"点了没反应" */
      const msg = (res && res.err_msg) || '';
      if (/fail|not_exist|invalid|unavailable/i.test(msg)) showWxGuide();
    });
    return true;
  } catch (e) { return false; }
}

/* 右下角"点击右上角 ···"引导层 */
function showWxGuide(withCopy) {
  const g = $('#wxGuide');
  if (!g) return;
  const t = g.querySelector('.wx-text');
  if (t) t.innerHTML = withCopy
    ? '<b>点击右上角 ●···</b><span>选「发送给朋友」即可把当前内容直接发给微信好友（链接已复制，发送后也可粘贴给其他好友）</span>'
    : '<b>点击右上角 ●···</b><span>选「发送给朋友」，即可把这套房源发给微信好友，好友打开就是房源页面</span>';
  g.classList.add('show');
}

function doShareWx(withCopy) {
  const c = State.share;
  if (!c) return;
  /* 分享前再同步一次卡片数据（房源标题/描述/首图），已配置公众号时立即生效 */
  try { WxShare.update(c); } catch (e) { }
  if (IS_WECHAT) {
    if (withCopy) { try { copyText(c.url); } catch (e) { } }
    if (wxBridgeShare(c)) {
      closeSheet();
      toast('已唤起微信转发，选择好友发送即可');
      return;
    }
    /* 转发唤起失败：保留分享面板，在其上方显示右上角引导 */
    showWxGuide(withCopy);
  } else {
    toast('请在微信中打开本页，点右上角「···」→「发送给朋友」即可转发');
  }
}

function doShareCopy() {
  const c = State.share;
  if (!c) return;
  copyText(c.url).then(ok => toast(ok ? '链接已复制，粘贴给微信好友即可' : '复制失败，请长按上方链接手动复制'));
}

function doSharePoster() {
  const c = State.share;
  if (!c) return;
  toast('正在生成海报…');
  buildPoster(c.kind, c.l, url => { closeSheet(); openPoster(url); });
}

function doShareMore() {
  const c = State.share;
  if (!c) return;
  if (navigator.share) {
    navigator.share({ title: c.title, text: c.desc, url: c.url }).catch(() => { });
  } else {
    doShareCopy();
  }
}

/* ---------- 公众号 JS-SDK 接入（可选） ---------- */
const WxShare = {
  ready: false,
  started: false,
  pending: null, /* 最近一次要应用的分享数据（页面切换会不断更新，就绪后自动生效） */
  setup(data) {
    if (data) this.pending = data;
    const conf = (Api.db.settings.wx) || {};
    if (!conf.appId || !IS_WECHAT || this.started) return false;
    this.started = true;
    const script = document.createElement('script');
    script.src = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
    script.onload = () => {
      // 正式环境：签名需由后端接口返回（基于当前 URL 调用公众号 jssdk 接口）
      // 未部署签名接口时会自动跳过，不影响其余分享方式
      fetch('/api/wx/jssdk?url=' + encodeURIComponent(location.href.split('#')[0]))
        .then(r => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(sig => {
          if (!window.wx) return;
          window.wx.config({
            debug: false, appId: conf.appId, timestamp: sig.timestamp, nonceStr: sig.nonceStr,
            signature: sig.signature, jsApiList: conf.jsApiList || []
          });
          window.wx.ready(() => {
            WxShare.ready = true;
            WxShare.update(WxShare.pending || data);
          });
        })
        .catch(e => console.warn('微信 JS-SDK 签名获取失败，已回退到引导分享', e));
    };
    script.onerror = () => console.warn('微信 JS-SDK 加载失败');
    document.head.appendChild(script);
    return true;
  },
  update(data) {
    if (data) this.pending = data;            /* 先记住最新数据（可能在就绪前调用） */
    if (!this.ready || !window.wx || !this.pending) return;
    const data2 = this.pending;
    /* 缩略图必须是公网可访问的 http(s) URL：
       房源优先用该房源首图（服务端 /api/photo 转出），否则回退到共享封面 / 站点图 */
    let img = data2.imgUrl || (Api.db.settings.share && Api.db.settings.share.img) || '';
    if (!/^https?:\/\//.test(img)) img = SHARE_BASE + '/assets/songshanhu-map.jpg';
    const d = { title: data2.title, desc: data2.desc, link: data2.url, imgUrl: img };
    window.wx.updateAppMessageShareData && window.wx.updateAppMessageShareData(d);
    window.wx.updateTimelineShareData && window.wx.updateTimelineShareData(d);
    window.wx.onMenuShareAppMessage && window.wx.onMenuShareAppMessage(d);
    window.wx.onMenuShareTimeline && window.wx.onMenuShareTimeline(d);
  }
};

/* ---------------- 全局事件委托 ---------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const v = el.dataset.v;
  const id = el.dataset.id;

  /* 房源精准定位（地图选点） */
  if (act === 'pick:loc') { sheetPickLoc(); return; }
  if (act === 'pick:parkLoc') { useParkLoc(); return; }
  if (act === 'pick:ok') { applyPickLoc(); return; }
  if (act === 'pick:search') { pickSearch(); return; }
  if (act === 'pick:item') { pickItem(el); return; }

  switch (act) {
    /* 导航 */
    case 'tab': setView(v, false); break;
    case 'catalog:retry': void window.refreshSiteListings?.(); break;
    case 'detail:retry': {
      /* 带新参数整页刷新：既重拉云端数据，也击穿微信 webview 的页面缓存 */
      const rsp = new URLSearchParams(location.search);
      rsp.set('r', String(Date.now()));
      location.href = location.pathname + '?' + rsp.toString();
      break;
    }
    case 'goto:admin': setView('admin', true); break;
    case 'nav:back': back(); break;
    case 'close:sheet': clearCodeTimer(); closeSheet(); break;
    case 'dlg:cancel': $('#dialogMask').classList.remove('show'); break;

    /* 分享 */
    /* 分享：手机端与电脑端统一弹出「分享转发」面板（房源卡片 + 微信好友/复制链接/海报）；
       面板内点「微信好友」再尝试直接唤起微信转发，失败时回退右上角引导 */
    case 'open:share': {
      const sid = id || (v === 'site' ? '' : State.params.id);
      if (v !== 'site' && sid) sheetShare('listing', sid);
      else sheetShare('site', '');
      break;
    }
    case 'share:wx': doShareWx(); break;
    case 'share:copy': doShareCopy(); break;
    case 'share:poster': doSharePoster(); break;
    case 'share:more': doShareMore(); break;
    case 'close:poster': closePoster(); break;
    case 'save:poster': savePoster(); break;
    case 'close:wxGuide': { const g = $('#wxGuide'); if (g) g.classList.remove('show'); break; }

    case 'gallery:expand': window.SiteMotion?.openPhoto(Number(v)); break;
    case 'gallery:prev': window.DetailGallery?.step(-1); break;
    case 'gallery:next': window.DetailGallery?.step(1); break;
    case 'gallery:go': window.DetailGallery?.go(Number(v)); break;
    case 'detail:costs': {
      const card=el.closest('.detail-sidebar'),expanded=!card.classList.contains('is-expanded');
      State.costDetailsId=expanded?id:null;card.classList.toggle('is-expanded',expanded);
      el.setAttribute('aria-expanded',String(expanded));el.querySelector('.costs-toggle-action span').textContent=expanded?'收起明细':'查看明细';
      break;
    }
    /* 房源 */
    case 'open:listing':
      openListing(id);
      break;

    /* 搜索与筛选 */
    case 'login:pending': toast('登录功能暂未开放'); break;
    case 'search:submit': void window.HomeSearch?.submit(); break;
    case 'search:quick': window.HomeSearch?.fill(v); break;
    case 'search:retry': void window.HomeSearch?.retry(); break;
    case 'search:clear': window.HomeSearch?.clear(); break;
    case 'hot:chip':
      if (el.dataset.range === '1') { State.filters.area = v; State.filters.kw = ''; }
      else { State.filters.kw = v; State.filters.area = '全部'; }
      refresh();
      break;
    case 'set:sort':
      State.filters.sort = State.filters.sort === v ? 'default' : v;
      refresh();
      break;
    case 'open:filter': sheetFilter(); break;
    case 'open:usagePicker': sheetSinglePicker('usage',['全部','写字楼','厂房','研发办公','仓储'],'选择房源类型'); break;
    case 'open:areaPicker': sheetSinglePicker('area',AREA_OPTS,'选择可租面积（㎡）'); break;
    case 'filters:remove':
      if(v==='kw'){window.HomeSearch?.clear();}else if(['usage','park','area','rent','orientation','decoration','layout'].includes(v)){State.filters[v]='全部';refresh();}
      break;
    case 'open:parkPicker':
      sheetSinglePicker('park', ['全部'].concat(parksAll().map(p => p.name)), '选择片区');
      break;
    case 'open:rentPicker': sheetSinglePicker('rent', RENT_OPTS, '选择租金单价（元/㎡·月）'); break;
    case 'filters:reset':
      State.filters = { kw: '', park: '全部', usage: '全部', rent: '全部', area: '全部', orientation: '全部', decoration: '全部', layout: '全部', sort: State.filters.sort };
      closeSheet(); window.HomeSearch?.clear(); refresh(); toast('筛选已重置');
      break;
    case 'filters:apply':
      if (State.filterDraft) State.filters = {...State.filterDraft};
      State.filterDraft = null; closeSheet(); refresh();
      break;

    /* 弹层内选项（seg） */
    case 'opt:seg': break;

    /* 地图 */
    case 'map:park': {
      State.mapPark = v || null;
      if (v) State.tmapFocus = v;             // 在线地图下把视图移到该园区
      if (State.view !== 'map') { State.stack = []; setView('map', false); }
      else render();
      if (!v) { State.mapScale = 1; State.mapX = 0; State.mapY = 0; State.tmapView = null; applyMapTransform(); }
      else centerOnPark(v);
      break;
    }
    /* 在线地图（腾讯 GL JS）控件 */
    case 'map:zoomin':
      if (State.tmap) State.tmap.setZoom(State.tmap.getZoom() + 1);
      break;
    case 'map:zoomout':
      if (State.tmap) State.tmap.setZoom(State.tmap.getZoom() - 1);
      break;
    case 'map:recenter': {
      const c = MapKit.center();
      if (State.tmap) { State.tmap.setCenter(new MapKit.T.LatLng(c.lat, c.lng)); State.tmap.setZoom(13); }
      break;
    }
    case 'map:locate': {
      State.mapPark = v || null;
      if (v) State.tmapFocus = v;             // 在线地图下聚焦该园区
      State.stack = [];
      setView('map', false);
      if (v) centerOnPark(v);
      break;
    }
    case 'map:zoom': {
      const d = Number(v);
      State.mapScale = Math.min(2.4, Math.max(1, +(State.mapScale + d * 0.25).toFixed(2)));
      const inner = $('#mapInner');
      if (inner) inner.style.transform = `translate(${State.mapX}px,${State.mapY}px) scale(${State.mapScale})`;
      break;
    }
    case 'map:reset':
      State.mapScale = 1; State.mapX = 0; State.mapY = 0; render();
      break;

    /* 联系 */
    case 'copy:region': {
      const area=window.SiteAreaLocation?.areaForListing({region:v});
      if(!area){toast('片区待确认，请联系招商顾问');break;}
      copyText('东莞市'+area.label).then(ok=>toast(ok?'片区名称已复制，可到常用地图搜索':'复制未成功，请长按片区名称手动复制'));
      break;
    }
    case 'copy:address': toast('详细地址仅限后台查看，请联系招商顾问'); break;
    case 'call': {
      const phone = v;
      if (!phone || !/^[0-9-]{7,}$/.test(phone)) { dialog({title:'联系电话待补充',text:'发布方还未填写电话。你可以打开房源详情，点击“留言”提交联系方式。',okText:'知道了'}); break; }
      dialog({
        title: '拨打电话', text: phone, okText: '立即拨打', onOk: () => { window.location.href = 'tel:' + phone; }
      });
      break;
    }

    /* 留言 / 登录 */
    case 'open:inquiry': sheetInquiry(id, el.dataset.type); break;
    case 'submit:inquiry': submitInquiry(id); break;
    case 'open:login': sheetVisitorLogin(); break;
    case 'send:code': sendVisitorCode(); break;
    case 'submit:visitorLogin': submitVisitorLogin(); break;
    case 'visitor:logout':
      dialog({
        title: '清除本机资料', text: '云端已提交资料会保留；本机将失去原客户编号的修改凭据，暂不能凭手机号找回。确定清除吗？', danger: true, onOk: () => {
          window.SiteCustomer.forget();State.session.visitor = null; saveSession(); toast('已清除本机资料'); refresh();
        }
      });
      break;
    case 'open:viewed': sheetViewed(); break;
    case 'open:about': sheetAbout(); break;
    case 'open:settings': sheetSettings(); break;

    /* 首页三入口 */
    case 'entry:usage': {
      State.filters.usage = (v === '写字楼' || v === '厂房') ? v : '全部';
      if (State.view !== 'home') setView('home', true);
      else { const hv = $('#view-home'); if (hv) hv.scrollTop = 0; render(); }
      break;
    }
    case 'set:usage': {
      sheetSinglePicker('usage',['全部','写字楼','厂房','研发办公','仓储'],'选择房源类型');
      break;
    }
    case 'open:resources': setView('resources', true); break;
    case 'open:indResForm': sheetIndRes(); break;
    case 'submit:indRes': submitIndRes(); break;
    case 'del:indRes': delIndRes(id); break;

    /* 我的企业 / 我的需求 */
    case 'open:myCompany': sheetMyCompany(); break;
    case 'submit:myCompany': submitMyCompany(); break;
    case 'open:myNeeds': sheetMyNeeds(); break;
    case 'add:myNeed': addMyNeed(); break;
    case 'del:myNeed': delMyNeed(v); break;

    /* AI 找房助手 */
    case 'open:aiMatch': sheetAiMatch(); break;
    case 'ai:quick': aiAsk(el.dataset.v); break;
    case 'ai:ask': aiAsk(); break;

    /* 管理端 */
    case 'open:adminLogin': window.location.href = ((window.__SITE_BACKEND__ || {}).basePath || '') + '/admin/'; break;
    case 'admin:login': window.location.href = ((window.__SITE_BACKEND__ || {}).basePath || '') + '/admin/'; break;
    case 'admin:logout':
      dialog({
        title: '退出管理后台', text: '退出后需重新输入账号密码，确定退出吗？', danger: true, onOk: () => {
          State.session.admin = null; saveSession(); State.stack = [];
          toast('已退出管理后台'); setView('mine', false);
        }
      });
      break;
    case 'admin:tab':
      State.adminTab = v;
      render();
      break;
    case 'admin:filter':
      State.adminListFilter = v;
      render();
      break;
    case 'admin:new':
      openSheet(listingFormHTML(null));
      bindListingForm();
      break;
    case 'admin:edit': {
      const l = findListing(id);
      if (!l) return toast('房源不存在');
      const open = () => { openSheet(listingFormHTML(l)); bindListingForm(); };
      /* 先把该房源的照片大图补全再打开表单：否则保存时会用"只有封面"的照片组覆盖云端，导致照片被删 */
      if (!l.photosLoaded && Cloud.ready && Cloud.client) {
        toast('正在读取该房源照片…');
        ensureListingPhotos(id).then(open).catch(open);
      } else open();
      break;
    }
    case 'admin:toggle': {
      const l = findListing(id);
      if (!l) return;
      const willOnline = l.status !== 'online';
      l.status = willOnline ? 'online' : 'offline';
      l.updatedAt = new Date().toISOString();
      Api.save();
      Cloud.pushRow('listings', l);
      toast(willOnline ? '房源已上架，游客端立即可见' : '房源已下架，游客端不再展示');
      const b2 = $('#adminBody');
      if (b2) b2.innerHTML = renderAdminBody();
      renderTabbar();
      break;
    }
    case 'admin:del': {
      const l = findListing(id);
      if (!l) return;
      dialog({
        title: '删除房源', text: `确定删除「${l.parkName} · ${l.building}」吗？该操作不可恢复。`,
        danger: true, okText: '确认删除', onOk: () => {
          Api.db.listings = Api.db.listings.filter(x => x.id !== id);
          Api.save();
          /* 记墓碑再删：其他设备（含客户手机上的旧缓存）同步时会按墓碑清理，
             不会再把这条已删除的房源推回云端复活 */
          Cloud.markDeleted('listings', id);
          /* 顺手清掉该房源的服务器独立照片，避免磁盘/云端堆积废图 */
          fetch('/api/photo/' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => { });
          State.session.viewed = (State.session.viewed || []).filter(x => x !== id);
          saveSession();
          toast('房源已删除，云端已同步');
          const body = $('#adminBody');
          if (body) body.innerHTML = renderAdminBody();
          renderTabbar();
        }
      });
      break;
    }
    case 'admin:save': saveListing(id || null); break;

    /* 园区管理 */
    case 'admin:newPark': parkFormSheet(null); break;
    case 'admin:editPark': parkFormSheet(v); break;
    case 'admin:delPark': {
      const p = Api.park(v);
      if (!p) return;
      dialog({
        title: '删除园区', text: `确定删除「${p.name}」吗？该园区下暂无房源时才可删除。`,
        danger: true, okText: '确认删除', onOk: () => {
          const r = Api.deletePark(v);
          toast(r.ok ? '园区已删除' : r.msg);
          const body = $('#adminBody');
          if (body) body.innerHTML = renderAdminBody();
        }
      });
      break;
    }
    case 'admin:savePark': saveParkSheet(id || null); break;

    /* 转发卡片自定义 */
    case 'admin:pickShareImg': pickShareImage(); break;
    case 'admin:clearShareImg': {
      if (!State.shareDraft) State.shareDraft = {};
      State.shareDraft.img = '';
      Api.db.settings.share.img = '';
      Api.save();
      const prev = $('#shareImgPrev');
      if (prev) prev.style.backgroundImage = 'none';
      const body = $('#adminBody');
      if (body) body.innerHTML = renderAdminBody();
      toast('已清除自定义封面');
      break;
    }
    case 'admin:saveShare': saveShareSettings(); break;

    case 'admin:addPhoto': {
      State.form.replaceIdx = -1;
      const inp = $('#photoInput');
      if (inp) inp.click();
      break;
    }
    case 'admin:chgPhoto': {
      State.form.replaceIdx = Number(el.dataset.i);
      const inp = $('#photoInput');
      if (inp) inp.click();
      break;
    }
    case 'admin:rmPhoto': {
      const i = Number(el.dataset.i);
      State.form.photos.splice(i, 1);
      State.form.photosTouched = true;
      renderUploadGrid();
      break;
    }
    case 'admin:export': exportListings(); break;
    case 'admin:exportVisitors': exportVisitors(); break;

    /* 留言处理 */
    case 'admin:reply': adminReplySheet(id); break;
    case 'reply:quick': {
      const box = $('#replyText');
      if (box) box.value = v;
      break;
    }
    case 'admin:doReply': {
      const m = Api.db.messages.find(x => x.id === id);
      if (!m) return;
      const txt = (($('#replyText') || {}).value || '').trim();
      if (!txt) return toast('请输入回复内容');
      m.reply = txt;
      m.status = 'done';
      Api.save();
      Cloud.pushRow('messages', m);
      closeSheet();
      toast('回复已发送，访客可在「我的留言」中查看');
      const body = $('#adminBody');
      if (body) body.innerHTML = renderAdminBody();
      renderTabbar();
      break;
    }
    case 'admin:delMsg': {
      const m = Api.db.messages.find(x => x.id === id);
      if (!m) return;
      dialog({
        title: '删除留言', text: '确定删除这条访客留言吗？', danger: true, okText: '删除', onOk: () => {
          Api.db.messages = Api.db.messages.filter(x => x.id !== id);
          Api.save();
          Cloud.markDeleted('messages', id);
          toast('留言已删除');
          const body = $('#adminBody');
          if (body) body.innerHTML = renderAdminBody();
          renderTabbar();
        }
      });
      break;
    }

    /* 管理员账号管理 */
    case 'admin:newAdmin': newAdminSheet(); break;
    case 'admin:doNewAdmin': doNewAdmin(); break;
    case 'admin:resetPwd': sheetResetPwd(id); break;
    case 'admin:doResetPwd': doResetPwd(id); break;
    case 'admin:toggleAdmin': {
      const a = Api.db.admins.find(x => x.id === id);
      if (!a || a.role === 'super') return;
      a.enabled = !a.enabled;
      Api.save();
      Cloud.markDirty('admins', a.id);
      Cloud.pushAdmins();
      toast(a.enabled ? '账号已启用' : '账号已停用');
      const body = $('#adminBody');
      if (body) body.innerHTML = renderAdminBody();
      break;
    }
    case 'admin:delAdmin': {
      const a = Api.db.admins.find(x => x.id === id);
      if (!a || a.role === 'super') return;
      dialog({
        title: '删除管理员', text: `确定删除管理员「${a.name}」（账号 ${a.username}）吗？`, danger: true, okText: '删除', onOk: () => {
          Api.db.admins = Api.db.admins.filter(x => x.id !== id);
          Api.save();
          /* 墓碑 + 上云：否则其他设备的旧账号列表会把它同步回来 */
          Cloud.markDeleted('admins', id);
          Cloud.pushAdmins();
          toast('管理员已删除');
          const body = $('#adminBody');
          if (body) body.innerHTML = renderAdminBody();
        }
      });
      break;
    }
    case 'admin:saveSettings': {
      const name = (($('#setSiteName') || {}).value || '').trim();
      const hot = (($('#setHotline') || {}).value || '').trim();
      const max = Number((($('#setMaxAdmins') || {}).value) || 5);
      if (!name) return toast('请填写平台名称');
      if (!hot) return toast('请填写招商热线');
      if (!max || max < 1 || max > 20) return toast('管理员上限需在 1-20 之间');
      if (max < Api.db.admins.length) return toast('上限不能小于当前管理员数量 ' + Api.db.admins.length);
      Api.db.settings.siteName = name;
      Api.db.settings.hotline = hot;
      Api.db.settings.maxAdmins = max;
      Api.save();
      Cloud.markDirtyKeys(['siteName', 'hotline', 'maxAdmins']);
      Cloud.pushMeta();
      toast('设置已保存，已同步到云端');
      const body = $('#adminBody');
      if (body) body.innerHTML = renderAdminBody();
      break;
    }
    case 'admin:saveIntegrations': {
      const s = Api.db.settings.sms || (Api.db.settings.sms = {});
      const ttl = Number((($('#setSmsTtl') || {}).value) || 300);
      const cd = Number((($('#setSmsCd') || {}).value) || 60);
      const mx = Number((($('#setSmsMax') || {}).value) || 5);
      if (ttl < 60 || ttl > 1800) return toast('验证码有效期需在 60-1800 秒之间');
      if (cd < 30 || cd > 300) return toast('发送间隔需在 30-300 秒之间');
      if (mx < 3 || mx > 10) return toast('最大尝试次数需在 3-10 次之间');
      s.ttlSec = ttl; s.cooldownSec = cd; s.maxTry = mx;
      s.demoShow = !!($('#setSmsDemo') || {}).checked;
      Api.db.settings.wx = Api.db.settings.wx || {};
      Api.db.settings.wx.appId = (($('#setWxAppId') || {}).value || '').trim();
      Api.db.settings.wx.appSecret = (($('#setWxSecret') || {}).value || '').trim();
      Api.db.settings.tmapKey = (($('#setTmapKey') || {}).value || '').trim();
      Api.save();
      Cloud.markDirtyKeys(['sms', 'wx', 'tmapKey']);
      Cloud.pushMeta();
      MapKit.T = null; MapKit.loading = null;   // Key 变化后允许重新加载地图 SDK
      toast('设置已保存，已同步到云端');
      const b = $('#adminBody');
      if (b) b.innerHTML = renderAdminBody();
      break;
    }
    case 'admin:resetPark': {
      Api.resetParkCoord(v);
      const body = $('#adminBody');
      if (body) { body.innerHTML = adminMapBody(); bindAnnotateMap(); }
      toast('已恢复「' + v + '」的默认坐标');
      break;
    }
    case 'admin:resetParkAll':
      dialog({
        title: '恢复默认坐标',
        text: '将清空全部手动校准记录，所有园区标记回到按经纬度标定的初始位置。',
        danger: true, okText: '确认恢复', onOk: () => {
          Api.db.settings.parkCoords = {};
          Api.save();
          const body = $('#adminBody');
          if (body) { body.innerHTML = adminMapBody(); bindAnnotateMap(); }
          toast('已恢复全部默认坐标');
        }
      });
      break;
    case 'admin:backupNow':
      Api.backupNow();
      refreshBackupList();
      toast('已备份当前数据快照');
      break;
    case 'admin:restoreBackup': {
      const bi = parseInt(el && el.dataset.i, 10);
      dialog({
        title: '恢复备份', text: '将把房源、园区、留言、管理员等数据恢复到所选快照（恢复前会再自动备份一次当前数据），确定继续吗？',
        danger: true, okText: '确认恢复', onOk: async () => {
          const r = await Api.restoreBackup(bi);
          if (!r.ok) return toast(r.msg || '恢复失败');
          toast('已恢复所选备份，云端同步中…');
          render(); renderTabbar();
        }
      });
      break;
    }
    case 'admin:reset':
      dialog({
        title: '恢复演示数据', text: '将自动备份你当前的数据（可在上方"备份与恢复"找回），然后还原初始房源、留言与访客示例。确定继续吗？',
        danger: true, okText: '确认恢复', onOk: () => {
          Api.reset();
          Api.logVisit();
          toast('已恢复演示数据，云端同步中…');
          Cloud.reconcile('listings', Api.db.listings);
          Cloud.reconcile('parks', Api.db.parks);
          Cloud.reconcile('messages', Api.db.messages);
          Cloud.reconcile('visitors', Api.db.visitors);
          Cloud.pushMeta();
          render(); renderTabbar();
        }
      });
      break;
    case 'admin:clearAll':
      dialog({
        title: '清空本机缓存', text: '只清空本机浏览器缓存，云端数据保持不变；重新打开页面会自动从云端恢复数据。确定继续吗？',
        danger: true, okText: '确认清空', onOk: () => {
          localStorage.removeItem(DB_KEY);
          localStorage.removeItem(SES_KEY);
          Api.load();
          reloadSession();
          toast('本机缓存已清空，正在从云端恢复…');
          /* 注意：只清本机，绝不能把本机数据"对账"推回云端——
             那会把云端真实房源覆盖成演示数据、并删掉云端房源 */
          Cloud.pull().then(() => { State.stack = []; setView('home', false); render(); });
        }
      });
      break;
  }
});

/* 弹层内 seg 选择（筛选器 / 表单状态） */
document.addEventListener('click', e => {
  const seg = e.target.closest('.seg[data-filter]');
  if (!seg) return;
  const btn = e.target.closest('button');
  if (!btn) return;
  const key = seg.dataset.filter;
  const filters = State.filterDraft || State.filters;
  filters[key] = btn.dataset.v;
  $$('button', seg).forEach(b => { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
  const apply = document.querySelector('[data-act="filters:apply"]');
  if (apply) apply.textContent = '查看 ' + applyFilters(onlineListings(),filters).length + ' 套房源';
});

/* 遮罩点击关闭 */
$('#sheetMask').addEventListener('click', e => { if (e.target.id === 'sheetMask') closeSheet(); });
$('#dialogMask').addEventListener('click', e => { if (e.target.id === 'dialogMask') $('#dialogMask').classList.remove('show'); });

/* 导航返回按钮 */
document.addEventListener('DOMContentLoaded', () => {
  const nb = $('#navBack');
  if (nb) nb.onclick = back;
});

/* 服务端注入的房源首屏数据（/l/<id> 或 /?id=<id> 分享页）：
   好友点开链接先立刻看到房源详情，不必等云端同步；只补缺，不覆盖本地已有数据 */
function applyDeepListing() {
  const d = window.__DEEP_LISTING__;
  if (!d || !d.id) return null;
  try {
    if (!Api.db.listings) Api.db.listings = [];
    const i = Api.db.listings.findIndex(x => x && x.id === d.id);
    if (i < 0) {
      Api.db.listings.unshift(d);
    } else {
      const cur = Api.db.listings[i];
      Object.keys(d).forEach(k => {
        const v = d[k];
        if (v === undefined || v === null || v === '') return;
        if (cur[k] === undefined || cur[k] === null || cur[k] === '') cur[k] = v;
      });
      if ((d.photos || []).length && !(cur.photos || []).length) cur.photos = d.photos;
    }
  } catch (e) { }
  return findListing(d.id);
}

/* ---------------- 启动 ---------------- */
function boot() {
  Api.load();
  // Re-read published inventory from the website backend; never show old demo parks.
  Api.db.listings = [];
  Api.db.parks = [];
  reloadSession();
  State.session.admin = null;
  Api.logVisit();
  applyDeepListing();
  applyShareMeta();
  if (State.session.admin) State.adminTab = 'listing';

  /* 云端同步：先渲染本地缓存保证秒开，随后拉云端合并；本端独有数据自动回推 */
  Cloud.init();
  const deepOpenFound = l => {
    State.deepPending = null;
    State.session.viewed = [l.id].concat((State.session.viewed || []).filter(x => x !== l.id)).slice(0, 20);
    Api.logView(l.id);
    saveSession();
    State.params.id = l.id;
    document.title = l.parkName + ' ' + l.area + '㎡ ' + l.rent + '元/㎡·月 · 松山湖产业招商';
    if (State.view === 'detail' && State.params.id === l.id) render();
    else setView('detail', true);
  };
  if (Cloud.ready) {
    Cloud.pull().then(async r => {
      applyShareMeta();
      curVisitor(); /* pull 整表替换 visitors 后重新对齐会话访客引用 */
      if (!State.deepPending) render();
      if (r && r.ok && !r.inited) await Cloud.seedIfEmpty();
      /* 云端连上后自动把本机历史 base64 照片搬到服务器，并把空间真正腾出来。
         不区分管理员/访客——照片占的是**这台设备**的空间，谁打开谁受益 */
      migratePhotosToServer().catch(e => console.warn('照片迁移跳过', e));
      /* 深链房源：本地没有的话，云端拉完再判一次（可能刚同步进来） */
      if (State.deepPending) {
        const did = State.deepPending;
        if (findListing(did)) { deepOpenFound(findListing(did)); return; }
        const again = await Cloud.pull();
        if (again && again.ok && findListing(did)) deepOpenFound(findListing(did));
        else { State.deepPending = null; render(); setTimeout(() => toast('未找到链接中的房源，可能已被删除'), 400); }
      }
    }).catch(() => { });
    setInterval(() => { Cloud.pull().then(ok => { if (ok && ok.ok && !State.deepPending) { curVisitor(); render(); } }).catch(() => { }); }, 30000);
  }

  /* 分享链接深链：?id=L1001 或 /l/L1001 直接打开房源，?park=园区名 打开地图并定位 */
  const sp = new URLSearchParams(location.search);
  const pathM = /^\/l\/([^/]+)\/?$/.exec(location.pathname || '');
  let deepId = sp.get('id') || '';
  if (!deepId && pathM) { try { deepId = decodeURIComponent(pathM[1]); } catch (e) { deepId = pathM[1]; } }
  const deepPark = sp.get('park');
  const l = deepId ? findListing(deepId) : null;

  if (l) {
    deepOpenFound(l);
  } else if (deepId) {
    /* 本地暂无该房源：先进详情页"云端加载中"状态，等 pull 完成后判定（见上方 pull 回调） */
    State.params.id = deepId;
    State.deepPending = deepId;
    setView('detail', false);
  } else if (deepPark && parksAll().some(p => p.name === deepPark)) {
    State.mapPark = deepPark;
    setView('map', false);
    centerOnPark(deepPark);
  } else {
    setView('home', false);
  }

  /* 微信原生分享（在 settings.wx.appId 中配置公众号后自动生效）。
     注意：必须在深链解析后再取分享上下文，否则分享出去的卡片会退回"站点"信息 */
  try {
    const cur = (State.view === 'detail' && State.params.id && findListing(State.params.id))
      ? shareCtx('listing', State.params.id)
      : shareCtx('site');
    WxShare.setup(cur);
  } catch (e) { /* 未配置公众号时静默回退到引导分享 */ }
}

boot();
