'use client';

import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';

const sections = [
  ['basic', '基本信息'], ['cost', '费用与条款'], ['space', '空间与装修'],
  ['factory', '厂房技术条件'], ['description', '配套与说明'],
  ['location', '内部地址'], ['contact', '联系方式'], ['media', '照片与视频'],
] as const;
type Row = { x: number; y: number; width: number; height: number };
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function HookRail({ y, from = 0, muted = false }: { y: number; from?: number; muted?: boolean }) {
  return <span className={`listing-outline-rail${muted ? ' muted' : ''}`} aria-hidden="true">
    <span className="listing-outline-line" style={{ top: from, height: Math.max(0, y - 7 - from) }}/>
    <svg className="listing-outline-hook" width="17" height="9" viewBox="0 0 17 9" fill="none" style={{ transform: `translateY(${y - 7}px)` }}>
      <path d="M1 0v1a6 6 0 0 0 6 6h9" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round"/>
    </svg>
  </span>;
}

export function ListingOutline({ industrial }: { industrial: boolean }) {
  const items = useMemo(() => sections.filter(([id]) => id !== 'factory' || industrial), [industrial]);
  const navRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const scrollTarget = useRef<{ id: string; until: number } | null>(null);
  const [activeId, setActiveId] = useState<string>('basic');
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const activeIndex = Math.max(0, items.findIndex(([id]) => id === activeId));
  const active = rows[activeIndex];
  const hintedId = hoverId ?? focusId;
  const hinted = hintedId === activeId ? undefined : rows[items.findIndex(([id]) => id === hintedId)];
  const activeY = active ? active.y + active.height / 2 : 0;
  const hintedY = hinted ? hinted.y + hinted.height / 2 : 0;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setRows(items.map((_, index) => {
      const row = rowRefs.current[index];
      return row ? { x: row.offsetLeft, y: row.offsetTop, width: row.offsetWidth, height: row.offsetHeight } : { x: 0, y: 0, width: 0, height: 0 };
    }));
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    rowRefs.current.slice(0, items.length).forEach(row => { if (row) observer.observe(row); });
    measure();
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const mobile = window.matchMedia('(max-width: 850px)').matches;
      const boundary = mobile ? (navRef.current?.offsetHeight ?? 72) + 28 : 40;
      const targets = items.map(([id]) => ({ id, node: document.getElementById(`listing-section-${id}`) })).filter(item => item.node !== null);
      const locked = scrollTarget.current;
      if (locked) {
        const node = targets.find(item => item.id === locked.id)?.node;
        const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        if (node && Date.now() < locked.until && Math.abs(node.getBoundingClientRect().top - boundary) > 14 && window.scrollY < maximum - 2) return;
        scrollTarget.current = null;
      }
      let current: string = items[0][0];
      for (const item of targets) {
        if (item.node!.getBoundingClientRect().top <= boundary + 18) current = item.id;
      }
      const last = targets.at(-1);
      if (last && window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 3) current = last.id;
      setActiveId(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const unlock = () => { scrollTarget.current = null; schedule(); };
    const onKey = (event: KeyboardEvent) => { if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) unlock(); };
    const observer = new ResizeObserver(schedule);
    const main = listRef.current?.closest('.listing-editor-layout')?.querySelector('.listing-editor-main');
    if (main) observer.observe(main);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('wheel', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', onKey);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollTarget.current = null;
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', onKey);
    };
  }, [items]);

  useEffect(() => {
    if (!window.matchMedia('(max-width: 850px)').matches || !active || !scrollRef.current) return;
    const scroller = scrollRef.current;
    const left = active.x < scroller.scrollLeft ? active.x - 8 : active.x + active.width > scroller.scrollLeft + scroller.clientWidth ? active.x + active.width - scroller.clientWidth + 8 : scroller.scrollLeft;
    scroller.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [active]);

  const select = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const node = document.getElementById(`listing-section-${id}`);
    if (!node) return;
    event.preventDefault();
    setActiveId(id);
    scrollTarget.current = { id, until: Date.now() + 1800 };
    node.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  };

  return <nav ref={navRef} className="listing-outline" aria-label="房源资料分区">
    <p>房源资料</p>
    <div className="listing-outline-scroll" ref={scrollRef}>
      <div className="listing-outline-list" ref={listRef} onMouseLeave={() => setHoverId(null)}>
        {active && <span className="listing-outline-highlight" aria-hidden="true" style={{ width: active.width, height: active.height, transform: `translate(${active.x}px, ${active.y}px)` }}/>}
        {active && <HookRail y={activeY}/>}
        {hinted && <HookRail y={hintedY} from={hintedY <= activeY ? Math.max(0, hintedY - 7) : activeY} muted/>}
        {items.map(([id, label], index) => <a key={id} ref={node => { rowRefs.current[index] = node; }} href={`#listing-section-${id}`} aria-current={index === activeIndex ? 'location' : undefined} onClick={event => select(event, id)} onMouseEnter={() => setHoverId(id)} onFocus={() => setFocusId(id)} onBlur={() => setFocusId(null)}>{label}</a>)}
      </div>
    </div>
    <small>标有 * 的为发布所需资料<br/>资料未齐可先保存草稿</small>
  </nav>;
}
