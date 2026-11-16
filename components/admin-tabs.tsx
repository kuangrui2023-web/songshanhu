'use client';

import { Building, Building2, MessageSquare, BarChart3, MapPin, Settings, Briefcase } from 'lucide-react';

const tabs = [
  { key: 'listings', label: '房源', icon: Building2 },
  { key: 'buildings', label: '楼栋', icon: Building },
  { key: 'companies', label: '企业', icon: Briefcase },
  { key: 'inquiries', label: '留言', icon: MessageSquare },
  { key: 'stats', label: '数据', icon: BarChart3 },
  { key: 'map', label: '地图标注', icon: MapPin },
  { key: 'parks', label: '园区', icon: Building2 },
  { key: 'settings', label: '设置', icon: Settings },
] as const;
export type AdminSection = typeof tabs[number]['key'];

/** 左侧固定菜单：竖排导航，键盘上下方向键切换。 */
export function AdminTabs({ section, pending, disabled, onChange, allowed }: { section: AdminSection; pending: number; disabled: boolean; onChange: (section: AdminSection) => void; allowed?: AdminSection[] }) {
  const items = allowed && allowed.length ? tabs.filter(tab => allowed.includes(tab.key)) : tabs;
  return <nav
    className="admin-nav"
    role="tablist"
    aria-label="后台管理板块"
    aria-orientation="vertical"
    onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(event.target as HTMLButtonElement);
      if (index < 0 || !buttons.length) return;
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }}
  >
    <p className="admin-nav-label">运营工作区</p>
    {items.map(tab => <button key={tab.key} role="tab" type="button" tabIndex={section === tab.key ? 0 : -1} aria-selected={section === tab.key} aria-controls="admin-section" id={`tab-${tab.key}`} disabled={disabled} className={section === tab.key ? 'active' : ''} onClick={() => onChange(tab.key)}><tab.icon size={17}/><span>{tab.label}</span>{tab.key === 'inquiries' && pending > 0 && <small>{pending}</small>}</button>)}
  </nav>;
}
