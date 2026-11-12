/* Server-owned first publication time, with a strict rolling 24-hour window. */
(function () {
  const WINDOW_MS = 24 * 60 * 60 * 1000;
  function expiresAt(listing) {
    if (listing.status !== 'online' || !listing.firstPublishedAt) return null;
    const published = Date.parse(listing.firstPublishedAt);
    return Number.isFinite(published) ? published + WINDOW_MS : null;
  }
  function isNew(listing, now = Date.now()) {
    const until = expiresAt(listing);
    return until !== null && now >= until - WINDOW_MS && now < until;
  }
  // Publication timestamps remain available; the visual badge has been retired.
  function badgeMarkup() { return ""; }
  window.SiteNewListings = { isNew, badgeMarkup };
})();
