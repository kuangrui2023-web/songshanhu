/* Shared, dependency-free feedback for the public site and secure admin. */
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button.btn,button.ai-btn,button.admin-primary,button.op-btn.pri');
    if (!button || button.disabled || reduced.matches || event.button > 0) return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'tap-ripple'; ripple.setAttribute('aria-hidden', 'true');
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX-rect.left-size/2}px;top:${event.clientY-rect.top-size/2}px`;
    button.append(ripple); setTimeout(() => ripple.remove(), 540);
  }, {passive:true});
  function prepare(root) {
    const images = [...(root.matches?.('.media-frame img') ? [root] : []), ...(root.querySelectorAll?.('.media-frame img') || [])];
    images.forEach(img => {
      if (img.dataset.feedbackBound) return;
      img.dataset.feedbackBound = 'true';
      const frame = img.closest('.media-frame');
      const update = () => {
        frame.classList.toggle('media-ready', img.naturalWidth > 0);
        frame.classList.toggle('media-error', !img.naturalWidth);
        frame.removeAttribute('aria-busy');
      };
      if (img.complete) update();
      else { frame.setAttribute('aria-busy','true'); img.addEventListener('load', update, {once:true}); img.addEventListener('error', update, {once:true}); }
    });
  }
  prepare(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => { if (node.nodeType === 1) prepare(node); }))).observe(document.body,{childList:true,subtree:true});
})();
