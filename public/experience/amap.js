/* Compatibility tombstone: map services were retired on 2026-10-21. */
(function () {
  delete window._AMapSecurityConfig;
  window.SiteMap = { mount() {}, destroy() {}, hasPosition: () => false, configured: () => false };
})();
