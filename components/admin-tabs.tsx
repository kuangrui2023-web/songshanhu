'use client';

import { useEffect, useRef } from 'react';
import { Building2, MessageSquare, BarChart3, MapPin, Settings } from 'lucide-react';

const tabs = [
  { key: 'listings', label: '房源', icon: Building2 },
  { key: 'inquiries', label: '留言', icon: MessageSquare },
  { key: 'stats', label: '数据', icon: BarChart3 },
  { key: 'map', label: '地图标注', icon: MapPin },
  { key: 'parks', label: '园区', icon: Building2 },
  { key: 'settings', label: '设置', icon: Settings },
] as const;
export type AdminSection = typeof tabs[number]['key'];
type Axis = { value: number; velocity: number; target: number; stiffness: number; mass: number; bounce: number; start: number };
const axis = (value: number): Axis => ({ value, velocity: 0, target: value, stiffness: 580, mass: .9, bounce: .25, start: 0 });

export function AdminTabs({ section, pending, disabled, onChange }: { section: AdminSection; pending: number; disabled: boolean; onChange: (section: AdminSection) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>('button[role=tab]'));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const hover = matchMedia('(hover: hover)');
    const values = buttons.map(() => [axis(0), axis(1), axis(1)]);
    let frame = 0, lastTime = 0, selected = -1, pressed: HTMLButtonElement | null = null;
    let pointer: { x: number; y: number } | null = null;
    const write = (index: number) => {
      const [x, sx, sy] = values[index];
      buttons[index].style.transform = `translateX(${x.value.toFixed(3)}px) scale(${sx.value.toFixed(4)},${sy.value.toFixed(4)})`;
    };
    const tick = (now: number) => {
      frame = 0;
      const dt = Math.min(.032, Math.max(.001, (now - (lastTime || now - 16)) / 1000));
      lastTime = now;
      let moving = false;
      values.forEach((axes, index) => {
        axes.forEach(a => {
          if (now < a.start) { moving = true; return; }
          const damping = 2 * Math.sqrt(a.stiffness * a.mass) * (1 - a.bounce);
          const steps = Math.ceil(dt / .004), step = dt / steps;
          for (let n = 0; n < steps; n++) {
            a.velocity += (-a.stiffness * (a.value - a.target) - damping * a.velocity) / a.mass * step;
            a.value += a.velocity * step;
          }
          if (Math.abs(a.value - a.target) < .0005 && Math.abs(a.velocity) < .005) { a.value = a.target; a.velocity = 0; }
          else moving = true;
        });
        write(index);
      });
      if (moving) frame = requestAnimationFrame(tick);
      else lastTime = 0;
    };
    const apply = (instant = false) => {
      const push = selected < 0 ? 0 : buttons[selected].offsetWidth * .2 / 2 + 6;
      const now = performance.now(), rtl = getComputedStyle(bar).direction === 'rtl' ? -1 : 1;
      values.forEach((axes, index) => {
        const distance = selected < 0 ? 0 : Math.abs(index - selected);
        const scale = selected < 0 || reduced.matches ? 1 : index === selected ? 1.2 : .95;
        const targets = [selected < 0 || reduced.matches ? 0 : Math.sign(index - selected) * push * rtl, scale, scale];
        const moving = axes.some(a => Math.abs(a.value - a.target) > .001 || Math.abs(a.velocity) > .01);
        buttons[index].classList.toggle('jelly-hovered', index === selected);
        axes.forEach((a, j) => {
          a.target = targets[j];
          a.stiffness = 580 * (1 - .12 * Math.min(distance, 3)) * (j === 1 ? 1.24 : j === 2 ? .86 : 1);
          a.mass = j === 1 ? .8 : j === 2 ? .95 : .9;
          a.bounce = j === 1 ? .55 : .25;
          a.start = now + (moving ? 0 : distance * 22) + (j === 2 ? 50 : 0);
          if (instant || reduced.matches) { a.value = a.target; a.velocity = 0; }
        });
        write(index);
      });
      cancelAnimationFrame(frame);
      frame = 0; lastTime = 0;
      if (!instant && !reduced.matches) frame = requestAnimationFrame(tick);
    };
    const sync = (instant = false) => {
      const element = pointer && hover.matches ? document.elementFromPoint(pointer.x, pointer.y)?.closest<HTMLButtonElement>('button[role=tab]') : null;
      const focused = buttons.find(button => button === document.activeElement && button.matches(':focus-visible'));
      // Selection keeps its blue background, but never supplies a scale target.
      const next = pressed || (element && bar.contains(element) ? element : null) || focused;
      const index = next && !next.disabled ? buttons.indexOf(next) : -1;
      if (index !== selected || instant) { selected = index; apply(instant); }
    };
    const onPointer = (event: PointerEvent) => { if (event.pointerType !== 'touch') { pointer = { x: event.clientX, y: event.clientY }; sync(); } };
    const onLeave = () => { pointer = null; sync(); };
    const onDown = (event: PointerEvent) => {
      if (event.button > 0) return;
      const button = (event.target as Element).closest<HTMLButtonElement>('button[role=tab]');
      if (!button || button.disabled) return;
      pressed = button;
      pointer = event.pointerType === 'touch' ? null : { x: event.clientX, y: event.clientY };
      sync();
    };
    const release = () => { pressed = null; sync(); };
    const reset = () => { pressed = null; pointer = null; selected = -1; apply(); };
    const onFocus = () => queueMicrotask(() => { if (bar.isConnected) sync(); });
    const measure = () => {
      const width = Math.max(...buttons.map(button => button.offsetWidth));
      bar.style.setProperty('--admin-jelly-edge', `${Math.max(16, Math.ceil(width * .2 * 1.3 / 2 + 12))}px`);
      sync(true);
    };
    bar.addEventListener('pointermove', onPointer, { passive: true });
    bar.addEventListener('pointerover', onPointer, { passive: true });
    bar.addEventListener('pointerleave', onLeave, { passive: true });
    bar.addEventListener('pointerdown', onDown, { passive: true });
    bar.addEventListener('focusin', onFocus);
    bar.addEventListener('focusout', onFocus);
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', reset, { passive: true });
    window.addEventListener('blur', reset);
    window.addEventListener('resize', measure);
    reduced.addEventListener('change', measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      bar.removeEventListener('pointermove', onPointer);
      bar.removeEventListener('pointerover', onPointer);
      bar.removeEventListener('pointerleave', onLeave);
      bar.removeEventListener('pointerdown', onDown);
      bar.removeEventListener('focusin', onFocus);
      bar.removeEventListener('focusout', onFocus);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', measure);
      reduced.removeEventListener('change', measure);
      buttons.forEach(button => { button.style.removeProperty('transform'); button.classList.remove('jelly-hovered'); });
    };
  }, [disabled]);

  return <div ref={ref} className="admin-workspace-tabs admin-jelly-tabs" role="tablist" aria-label="后台管理板块" onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0 || !buttons.length) return;
    event.preventDefault();
    buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length].focus();
  }}>{tabs.map(tab => <button key={tab.key} role="tab" type="button" tabIndex={section === tab.key ? 0 : -1} aria-selected={section === tab.key} aria-controls="admin-section" id={`tab-${tab.key}`} disabled={disabled} className={section === tab.key ? 'active' : ''} onClick={() => onChange(tab.key)}><tab.icon size={18}/>{tab.label}{tab.key === 'inquiries' && pending > 0 && <small>{pending}</small>}</button>)}</div>;
}
