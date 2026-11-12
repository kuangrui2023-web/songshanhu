/* Adapted from the supplied JellyRadio: same swell/push and three spring axes.
 * The public site uses DOM templates, so this keeps its existing click handlers
 * and carries spring positions across the template replacement on sorting. */
(() => {
  const home = document.getElementById('view-home');
  const reduced = matchMedia('(prefers-reduced-motion:reduce)');
  const cfg = { swell: .2, barge: 6, shrink: .05, jelly: 1, bounce: .25, stagger: 22, stiffness: 580 };
  const values = new Map();
  let bar = null, chips = [], selected = '', frame = 0, lastTime = 0, savedScroll = 0, focusedKey = '', pressedKey = '', pointer = null;
  const keyOf = el => `${el.dataset.act}:${el.dataset.v || ''}`;
  const axis = value => ({ value, velocity: 0, target: value, stiffness: 580, mass: .9, bounce: .25, start: 0 });
  function syncSelection() {
    // Derive from current state, never from the last clicked button. A deselected
    // sort returns to 1x once hover/press leaves, including after template swaps.
    const pointed=pointer&&matchMedia('(hover:hover)').matches?document.elementFromPoint(pointer.x,pointer.y)?.closest('.filter-chip'):null;
    const hovered=pointed&&bar?.contains(pointed)?pointed:null;
    const focused=chips.find(chip=>chip===document.activeElement&&chip.matches(':focus-visible'));
    const active=chips.find(chip=>chip.dataset.act==='set:sort'&&chip.classList.contains('on'))||chips.find(chip=>chip.classList.contains('on'));
    const chosen=hovered||focused||active;
    selected=pressedKey||(chosen?keyOf(chosen):'');
  }
  function sync(force=false){const previous=selected;syncSelection();if(force===true||previous!==selected)apply();}
  function write(chip) {
    const mv = values.get(keyOf(chip));
    if (mv) chip.style.transform = `translateX(${mv.x.value.toFixed(3)}px) scale(${mv.sx.value.toFixed(4)},${mv.sy.value.toFixed(4)})`;
  }
  function tick(now) {
    frame = 0;
    if (!bar?.isConnected || !home.classList.contains('active')) { lastTime = 0; return; }
    const dt = Math.min(.032, Math.max(.001, (now - (lastTime || now - 16)) / 1000));
    lastTime = now;
    let moving = false;
    chips.forEach(chip => {
      const mv = values.get(keyOf(chip));
      for (const a of [mv.x, mv.sx, mv.sy]) {
        if (now < a.start) { moving = true; continue; }
        const damping = 2 * Math.sqrt(a.stiffness * a.mass) * (1 - a.bounce);
        // Small integration steps remain stable after slow/paused browser frames.
        const steps = Math.ceil(dt / .004), step = dt / steps;
        for (let n = 0; n < steps; n++) {
          a.velocity += (-a.stiffness * (a.value - a.target) - damping * a.velocity) / a.mass * step;
          a.value += a.velocity * step;
        }
        if (Math.abs(a.value - a.target) < .0005 && Math.abs(a.velocity) < .005) {
          a.value = a.target; a.velocity = 0;
        } else moving = true;
      }
      write(chip);
    });
    if (moving) frame = requestAnimationFrame(tick);
    else lastTime = 0;
  }
  function apply(instant = false) {
    if (!bar || !chips.length) return;
    const at = chips.findIndex(chip => keyOf(chip) === selected);
    const rtl = getComputedStyle(bar).direction === 'rtl' ? -1 : 1;
    const push = at < 0 ? 0 : chips[at].offsetWidth * cfg.swell / 2 + cfg.barge;
    const now = performance.now();
    chips.forEach((chip, i) => {
      const mv = values.get(keyOf(chip)), on = i === at;
      chip.classList.toggle('jelly-selected', on);
      const distance = at < 0 ? 0 : Math.abs(i - at);
      const k = cfg.stiffness * (1 - .12 * Math.min(distance, 3));
      const scale = at < 0 || reduced.matches ? 1 : on ? 1 + cfg.swell : 1 - cfg.shrink;
      const targets = [reduced.matches ? 0 : Math.sign(i - at) * push * rtl, scale, scale];
      const active = [mv.x, mv.sx, mv.sy].some(a => Math.abs(a.value - a.target) > .001 || Math.abs(a.velocity) > .01);
      [mv.x, mv.sx, mv.sy].forEach((a, j) => {
        a.target = targets[j];
        a.stiffness = k * (j === 1 ? 1 + .24 * cfg.jelly : j === 2 ? 1 - .14 * cfg.jelly : 1);
        a.mass = j === 1 ? .9 - .1 * cfg.jelly : j === 2 ? .9 + .05 * cfg.jelly : .9;
        a.bounce = j === 1 ? Math.min(.85, cfg.bounce + .3 * cfg.jelly) : cfg.bounce;
        a.start = now + (active ? 0 : distance * cfg.stagger) + (j === 2 ? 50 * cfg.jelly : 0);
        if (instant || reduced.matches) { a.value = a.target; a.velocity = 0; }
      });
      write(chip);
    });
    if (frame) cancelAnimationFrame(frame);
    frame = 0; lastTime = 0;
    if (!instant && !reduced.matches) frame = requestAnimationFrame(tick);
  }
  function measure() {
    if (!bar?.isConnected) return;
    const maxWidth = Math.max(0, ...chips.map(chip => chip.offsetWidth));
    // Reserve space for the expanded end chips AND the spring overshoot.
    bar.style.setProperty('--jelly-edge', `${Math.max(24, Math.ceil(maxWidth * cfg.swell * 1.3 / 2 + cfg.barge + 6))}px`);
  }
  function mount() {
    const next = home?.querySelector('.filter-bar');
    if (!next) return;
    bar = next;
    chips = Array.from(bar.querySelectorAll(':scope > .filter-chip'));
    bar.classList.add('jelly-filters');
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '房源筛选与排序');
    chips.forEach(chip => {
      const key = keyOf(chip);
      if (!values.has(key)) values.set(key, { x: axis(0), sx: axis(1), sy: axis(1) });
      if (chip.dataset.act === 'set:sort') chip.setAttribute('aria-pressed', String(chip.classList.contains('on')));
      else if (chip.dataset.act.startsWith('open:')) chip.setAttribute('aria-haspopup', 'dialog');
    });
    measure();
    bar.scrollLeft = savedScroll;
    if (focusedKey) chips.find(chip => keyOf(chip) === focusedKey)?.focus({ preventScroll: true });
    focusedKey = '';
    sync(true);
  }
  // Capture before the original handler opens a picker or re-renders results.
  home?.addEventListener('click', event => {
    const chip = event.target.closest('.jelly-filters > .filter-chip');
    if (!chip || chip.disabled) return;
    sync();
    const index = chips.indexOf(chip), mv = values.get(keyOf(chip));
    const left = chip.offsetLeft - bar.offsetLeft + mv.x.target - chip.offsetWidth * cfg.swell / 2;
    const right = left + chip.offsetWidth * (1 + cfg.swell);
    let nextScroll = bar.scrollLeft;
    if (left < nextScroll + 8) nextScroll = Math.max(0, left - 8);
    else if (right > nextScroll + bar.clientWidth - 8) nextScroll = right - bar.clientWidth + 8;
    // Synchronous scroll survives the results template being replaced below.
    if (index >= 0) bar.scrollLeft = nextScroll;
    savedScroll = bar.scrollLeft;
    // The original click handler below may toggle .on off or replace the toolbar.
    queueMicrotask(sync);
  }, true);
  home?.addEventListener('pointermove',event=>{if(event.pointerType==='touch')return;pointer={x:event.clientX,y:event.clientY};sync();},{passive:true});
  home?.addEventListener('pointerover',event=>{if(event.pointerType==='touch')return;pointer={x:event.clientX,y:event.clientY};sync();},{passive:true});
  home?.addEventListener('pointerleave',()=>{pointer=null;sync();},{passive:true});
  home?.addEventListener('pointerdown',event=>{
    const chip=event.target.closest('.jelly-filters > .filter-chip');if(!chip||chip.disabled)return;
    if(event.pointerType!=='touch')pointer={x:event.clientX,y:event.clientY};else pointer=null;
    pressedKey=keyOf(chip);sync();
  },{passive:true});
  const release=()=>{pressedKey='';sync();};
  window.addEventListener('pointerup',release,{passive:true});
  window.addEventListener('pointercancel',release,{passive:true});
  window.addEventListener('blur',()=>{pressedKey='';pointer=null;sync();});
  home?.addEventListener('focusin',()=>queueMicrotask(sync));
  home?.addEventListener('focusout',()=>queueMicrotask(sync));
  home?.addEventListener('keydown', event => {
    const chip = event.target.closest('.jelly-filters > .filter-chip');
    if (!chip || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = chips.indexOf(chip);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? chips.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + chips.length) % chips.length;
    chips[next].focus();
  });
  window.HomeFilterChips = {
    beforeRender(el) {
      if (el !== home || !bar?.isConnected) return;
      savedScroll = bar.scrollLeft;
      const focused = document.activeElement;
      focusedKey = bar.contains(focused) && focused.matches('.filter-chip') ? keyOf(focused) : '';
    },
    afterRender(el) { if (el === home) mount(); }
  };
  window.addEventListener('resize', () => { measure(); syncSelection(); apply(true); });
  reduced.addEventListener('change', () => apply(true));
  document.fonts?.ready.then(() => { measure(); apply(true); });
  mount();
})();
