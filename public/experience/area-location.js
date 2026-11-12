/* External fixed schematic points only. NEVER derive a point from a listing. */
(function () {
  // Coarse, manually chosen GCJ-02 illustration points. Not official centers,
  // boundaries, verified property positions, or private listing coordinates.
  const regions = {
    北部:{label:'松山湖北部',position:'113.89,22.96'},
    中部:{label:'松山湖中部',position:'113.88,22.92'},
    南部:{label:'松山湖南部',position:'113.89,22.88'},
    生态园:{label:'松山湖生态园',position:'113.94,23.04'},
    大朗:{label:'大朗镇',position:'113.94,22.94'},
    寮步:{label:'寮步镇',position:'113.88,23.00'},
    大岭山:{label:'大岭山镇',position:'113.84,22.90'},
    东城:{label:'东城',position:null},
    南城:{label:'南城',position:null}
  };
  function areaForListing(listing) {
    // Only the saved, allowlisted region can select a broad area.
    const region = listing?.region;
    if (typeof region!=='string'||!Object.prototype.hasOwnProperty.call(regions,region)) return null;
    return {region,...regions[region]};
  }
  function linkForListing(listing) {
    const area = areaForListing(listing);
    if (!area||!area.position) return null;
    const params = new URLSearchParams({position:area.position,name:area.label+'片区示意点（非房源位置）',coordinate:'gaode',src:'songshanhu-region',callnative:'0'});
    return {...area,url:'https://uri.amap.com/marker?' + params.toString()};
  }
  function markup(listing) {
    const link = linkForListing(listing);
    const area = areaForListing(listing);
    if (area&&!link) return '<p class="area-location-hint">大致片区：'+area.label+'；具体位置请联系招商顾问。</p>';
    if (!link) return '<p class="area-location-hint">大致片区待确认，请联系招商顾问了解位置。</p>';
    // Both label and URL are built from the fixed allowlist, not user HTML.
    return '<div class="area-location"><div class="area-location-copy"><strong>大致片区：' + link.label + '</strong><p>固定点仅作片区示意，非房源位置；具体位置请联系招商。地图打不开时，可复制片区名称到常用地图搜索。</p></div><div class="area-location-actions"><a class="op-btn pri area-location-link" href="' + link.url.replaceAll('&','&amp;') + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" aria-label="查看片区示意：' + link.label + '（非房源位置，打开高德地图）">查看片区示意<span aria-hidden="true"> ↗</span></a><button class="op-btn area-location-copy-button" type="button" data-act="copy:region" data-v="' + link.region + '">复制片区名称</button></div></div>';
  }
  window.SiteAreaLocation = {areaForListing,linkForListing,markup};
})();
