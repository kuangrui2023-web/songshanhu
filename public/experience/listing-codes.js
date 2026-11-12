/* Six-digit codes are public identifiers, never property addresses or room numbers. */
(() => {
  const parse=value=>String(value??'').normalize('NFKC').trim().match(/^(?:(?:房源编号|房源|编号)\s*[:#]?\s*|#\s*)?([0-9]{6})$/)?.[1]||null;
  window.SiteListingCodes={parse};
})();
