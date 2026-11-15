'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Download, LoaderCircle, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { downloadCsv, type Park } from '@/lib/admin-workspace';
import {
  blankCompany, companyKey, deleteCompany, loadCompanies, lookupCompany, saveCompanies, saveCompany,
  type Company, type CompanyInput, type CompanyLookupFields, type CompanyLookupResult,
} from '@/lib/companies';
import { companyCsvRows, IMPORT_COLUMNS, parseCompanySheet, type ParsedSheet, type RowIssue } from '@/lib/company-import';
import { readTableFile } from '@/lib/sheet-read';
import { loadBuildings, type Building } from '@/lib/buildings';

type Props = {
  parks: Park[];
  assignedPark: string | null;
  parkOnly: boolean;
  /** 楼栋管理员：只能维护自己负责的楼栋及其企业。 */
  buildingOnly?: boolean;
  onBusy: (busy: boolean) => void;
};

const PAGE = 100;
const detail = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请重试。');

/** 快查能补充的字段；顺序也是结果面板里的显示顺序。 */
const LOOKUP_FIELDS: { key: keyof CompanyLookupFields; label: string }[] = [
  { key: 'name', label: '企业名称' },
  { key: 'unified_code', label: '统一社会信用代码' },
  { key: 'legal_representative', label: '法定代表人' },
  { key: 'registered_capital', label: '注册资本（万元）' },
  { key: 'established_on', label: '成立日期' },
  { key: 'status', label: '经营状态' },
  { key: 'industry', label: '所属行业' },
  { key: 'social_insurance_count', label: '参保人数' },
  { key: 'address', label: '注册地址' },
  { key: 'business_scope', label: '经营范围' },
];

const nameKey = (value: string) => String(value || '').replace(/[\s（）()·]/g, '').toLowerCase();

export function CompanyWorkspace({ parks, assignedPark, parkOnly, buildingOnly = false, onBusy }: Props) {
  const [list, setList] = useState<Company[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [buildingFilter, setBuildingFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [parkFilter, setParkFilter] = useState(assignedPark || '');
  const [visible, setVisible] = useState(PAGE);
  const [editing, setEditing] = useState<CompanyInput | null>(null);
  const [preview, setPreview] = useState<(ParsedSheet & { fileName: string; skippedSheets: string[] }) | null>(null);
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<CompanyLookupResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const parkNames = (buildingOnly
    ? [...new Set(buildings.map(b => b.region).filter((name): name is string => Boolean(name)))]
    : parkOnly ? [assignedPark].filter(Boolean) : parks.filter(p => p.active).map(p => p.name)) as string[];

  async function refresh() {
    setLoading(true);
    try { setList(await loadCompanies()); }
    catch (e) { setError(detail(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    // RLS 只返回当前管理员有权维护的楼栋：楼栋管理员拿到自己负责的楼栋，园区管理员拿到本园区。
    void loadBuildings().then(setBuildings).catch(() => setBuildings([]));
  }, []);

  function lock(value: boolean) { setBusy(value); onBusy(value); }

  const filtered = list.filter(item => {
    if (parkFilter && item.park !== parkFilter) return false;
    if (buildingFilter) {
      const target = buildings.find(b => b.id === buildingFilter);
      if (item.building_id !== buildingFilter && (!target || item.building !== target.name)) return false;
    }
    if (!keyword.trim()) return true;
    const k = keyword.trim().toLowerCase();
    return [item.name, item.industry, item.legal_representative, item.address, item.unified_code]
      .some(v => String(v || '').toLowerCase().includes(k));
  });

  const existing = new Map(list.map(item => [companyKey(item.name, item.park), item]));

  function startNew() {
    const base = blankCompany(parkOnly ? assignedPark : (parkFilter || null));
    if (buildingOnly) {
      const target = buildings.find(b => b.id === buildingFilter) || buildings[0];
      if (target) {
        base.building_id = target.id;
        base.building = target.name;
        base.park = target.region || base.park;
      }
    }
    setEditing(base);
    setMessage(''); setError(''); setLookupResult(null);
  }

  async function runLookup() {
    if (!editing || lookupBusy || busy) return;
    const name = editing.name.trim();
    if (name.length < 2) { setError('请先填写完整的企业名称，再点「快查查询」。'); return; }
    setLookupBusy(true); setError(''); setMessage(''); setLookupResult(null);
    try {
      setLookupResult(await lookupCompany(name));
    } catch (e) { setError(detail(e)); }
    finally { setLookupBusy(false); }
  }

  /** empty=只补空字段；overwrite=用快查结果覆盖已有内容。名称不一致时总是更正为企业全称。 */
  function applyLookup(mode: 'empty' | 'overwrite') {
    if (!editing || !lookupResult) return;
    const next = { ...editing };
    const mismatch = Boolean(lookupResult.matched_name) && nameKey(lookupResult.matched_name || '') !== nameKey(editing.name);
    const filled: string[] = [];
    const skipped: string[] = [];
    for (const { key, label } of LOOKUP_FIELDS) {
      const value = lookupResult.company[key];
      if (value === null || value === undefined || value === '') continue;
      if (key === 'name') {
        if (mode === 'overwrite' || mismatch) { next.name = String(value); filled.push(label); }
        continue;
      }
      const current = (next as unknown as Record<string, unknown>)[key];
      const empty = current === null || current === undefined || current === '';
      if (empty || mode === 'overwrite') {
        (next as unknown as Record<string, unknown>)[key] = value;
        filled.push(label);
      } else if (String(current) !== String(value)) {
        skipped.push(label);
      }
    }
    setEditing(next);
    setMessage(filled.length
      ? `已从快查填入：${filled.join('、')}。${skipped.length ? `已有内容未覆盖：${skipped.join('、')}。` : ''}保存前请核对。`
      : `快查没有可补充的新内容${skipped.length ? `；${skipped.join('、')}已有内容` : ''}。`);
    if (mode === 'overwrite') setLookupResult(null);
  }

  /** 选择楼栋时同步楼栋名称和片区，前台按 building_id 归楼。 */
  function chooseBuilding(id: string) {
    const target = buildings.find(b => b.id === id);
    setEditing(cur => cur ? {
      ...cur,
      building_id: target?.id || null,
      building: target?.name || cur.building,
      park: target?.region || cur.park,
    } : cur);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    if (!editing.name.trim()) { setError('企业名称不能为空。'); return; }
    if (parkOnly && editing.park !== assignedPark) { setError('只能维护本园区企业。'); return; }
    if (buildingOnly && !buildings.some(b => b.id === editing.building_id)) { setError('请选择你负责的楼栋。'); return; }
    lock(true); setError(''); setMessage('');
    try {
      await saveCompany(editing);
      await refresh();
      setEditing(null);
      setMessage('企业资料已保存。前台展示的是打码后的内容，真实值只有管理员能看到。');
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  async function remove(item: Company) {
    if (!window.confirm(`删除「${item.name}」？删除后前台不再展示，此操作不可恢复。`)) return;
    lock(true); setError(''); setMessage('');
    try { await deleteCompany(item.id); await refresh(); setMessage(`已删除「${item.name}」。`); }
    catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  async function chooseFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(''); setMessage(''); setPreview(null);
    lock(true);
    try {
      const table = await readTableFile(file);
      const parsed = parseCompanySheet(table.rows, parkNames, file.name);
      if (!parsed.companies.length) {
        setError(parsed.issues[0]?.message || '文件里没有可导入的数据行。');
        return;
      }
      setPreview({ ...parsed, fileName: file.name, skippedSheets: table.skippedSheets });
    } catch (e) { setError(detail(e)); }
    finally { lock(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function confirmImport() {
    if (!preview || busy) return;
    const inserts: CompanyInput[] = [];
    const updates: CompanyInput[] = [];
    let duplicated = 0;
    for (const row of preview.companies) {
      const { __row, ...data } = row;
      const hit = existing.get(companyKey(data.name, data.park));
      if (hit) {
        if (mode === 'update') updates.push({ ...data, id: hit.id });
        else duplicated++;
      } else inserts.push(data);
    }
    if (!inserts.length && !updates.length) {
      setError(`这 ${preview.companies.length} 条都已在库里（同名同园区），没有需要写入的数据。`);
      return;
    }
    lock(true); setError('');
    try {
      const chunks = <T,>(arr: T[]) => arr.reduce<T[][]>((acc, x, i) => { if (i % 100 === 0) acc.push([]); acc[acc.length - 1].push(x); return acc; }, []);
      let saved = 0;
      for (const chunk of chunks(inserts)) saved += (await saveCompanies(chunk)).length;
      for (const chunk of chunks(updates)) saved += (await saveCompanies(chunk)).length;
      await refresh();
      setPreview(null);
      setMessage(`导入完成：新增 ${inserts.length} 家，更新 ${updates.length} 家，跳过重复 ${duplicated} 家（共写入 ${saved} 条）。`);
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  function exportAll() {
    if (!filtered.length) { setError('当前筛选条件下没有可导出的企业。'); return; }
    const rows = companyCsvRows(filtered as unknown as CompanyInput[]);
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    downloadCsv(`企业名录-${parkFilter || '全部'}-${date}.csv`, [...IMPORT_COLUMNS], rows);
    setMessage(`已导出 ${filtered.length} 家（含明文字段，请勿外传）。`);
  }

  if (loading) return <div className="workspace-card admin-empty"><LoaderCircle className="feedback-spinner" size={20}/> 正在读取企业名录…</div>;

  if (preview) {
    const conflict = preview.companies.filter(c => existing.has(companyKey(c.name, c.park))).length;
    return <div className="workspace-stack">
      <div className="workspace-card">
        <div className="workspace-card-heading"><h2>导入预览：{preview.fileName}</h2><button type="button" disabled={busy} onClick={() => setPreview(null)}><X size={16}/> 返回列表</button></div>
        <p className="workspace-help">读到 {preview.companies.length} 家可导入企业；其中 {conflict} 家与库里已有记录同名同园区。{preview.skippedSheets.length > 0 && ` 只读取了第一个工作表，其余 ${preview.skippedSheets.length} 个未导入。`}</p>
        {preview.trimmedContacts > 0 && <p className="workspace-help">有 {preview.trimmedContacts} 家填了多个电话或邮箱，系统只保留第一个。</p>}
        {preview.unknownHeaders.length > 0 && <p className="workspace-help">未识别的列（会被忽略）：{preview.unknownHeaders.join('、')}</p>}
        {preview.issues.some(issue => issue.blocking) && <div className="admin-error" role="alert">
          有 {preview.issues.filter(issue => issue.blocking).length} 行未通过校验，不会导入：
          <ul>{preview.issues.filter(issue => issue.blocking).slice(0, 10).map((issue: RowIssue, i) => <li key={i}>第 {issue.row} 行 · {issue.field}：{issue.message}</li>)}{preview.issues.filter(issue => issue.blocking).length > 10 && <li>……其余 {preview.issues.filter(issue => issue.blocking).length - 10} 行略。</li>}</ul>
        </div>}
        {preview.issues.some(issue => !issue.blocking) && <div className="workspace-notice" role="status">
          另有 {preview.issues.filter(issue => !issue.blocking).length} 处提醒，这些企业照常导入：
          <ul>{preview.issues.filter(issue => !issue.blocking).slice(0, 5).map((issue: RowIssue, i) => <li key={i}>第 {issue.row} 行 · {issue.field}：{issue.message}</li>)}{preview.issues.filter(issue => !issue.blocking).length > 5 && <li>……其余 {preview.issues.filter(issue => !issue.blocking).length - 5} 处略。</li>}</ul>
        </div>}
        <fieldset disabled={busy} className="workspace-chips" style={{ marginTop: 12 }}>
          <legend className="workspace-help">遇到同名同园区的企业怎么办？</legend>
          <button type="button" className={mode === 'skip' ? 'active' : ''} onClick={() => setMode('skip')}>跳过（保留库里现有资料）</button>
          <button type="button" className={mode === 'update' ? 'active' : ''} onClick={() => setMode('update')}>更新（用文件内容覆盖）</button>
        </fieldset>
        <div className="workspace-actions" style={{ marginTop: 16 }}>
          <button className="admin-primary" type="button" disabled={busy} onClick={() => void confirmImport()}>
            {busy ? <LoaderCircle className="feedback-spinner" size={18}/> : <Upload size={18}/>} {busy ? '正在写入…' : '确认导入'}
          </button>
        </div>
        <div className="visitor-table-scroll" style={{ maxHeight: '50vh', overflow: 'auto', marginTop: 16 }}>
          <table className="visitor-table">
            <thead><tr><th>行</th><th>企业名称</th><th>园区</th><th>行业</th><th>状态</th><th>法人</th><th>电话</th></tr></thead>
            <tbody>{preview.companies.slice(0, 200).map(c => <tr key={c.__row}>
              <td data-nowrap>{c.__row}</td><td>{c.name}</td><td>{c.park || '—'}</td><td>{c.industry || '—'}</td><td data-nowrap>{c.status || '—'}</td>
              <td>{c.legal_representative || '—'}</td><td>{c.phone || '—'}</td>
            </tr>)}</tbody>
          </table>
          {preview.companies.length > 200 && <p className="workspace-help">仅预览前 200 行，实际会全部导入。</p>}
        </div>
      </div>
    </div>;
  }

  if (editing) {
    const set = <K extends keyof CompanyInput>(key: K, value: CompanyInput[K]) => setEditing(cur => cur ? { ...cur, [key]: value } : cur);
    const text = (key: keyof CompanyInput) => (editing[key] == null ? '' : String(editing[key]));
    const lookupMismatch = Boolean(lookupResult?.matched_name) && nameKey(lookupResult?.matched_name || '') !== nameKey(editing.name);
    return <form className="admin-editor" onSubmit={submit} noValidate>
      <div className="admin-editor-heading"><div><h2>{editing.id ? '编辑企业' : '新增企业'}</h2><p>敏感字段（法人、电话、邮箱、参保人数）在前台会自动打码。</p></div><button type="button" disabled={busy} onClick={() => setEditing(null)}>返回列表</button></div>
      <fieldset className="admin-fields" disabled={busy}>
        <label>企业名称<span aria-hidden="true">*</span><input required value={text('name')} onChange={e => set('name', e.target.value)} maxLength={200}/></label>
        <div className="lookup-row">
          <button type="button" className="admin-secondary" disabled={busy || lookupBusy} onClick={() => void runLookup()}>
            {lookupBusy ? <LoaderCircle className="feedback-spinner" size={16}/> : <Search size={16}/>} {lookupBusy ? '正在查询快查…' : '快查查询'}
          </button>
          <small>按营业执照全称查询，每次约 0.05 元；已有内容不会被自动覆盖。</small>
        </div>
        {lookupResult && <div className="lookup-result" role="status">
          <strong>快查结果：{lookupResult.matched_name || '已返回'}</strong>
          {lookupMismatch && <p className="lookup-warning">返回的企业名称与输入不完全一致，请确认是同一家。点「填入」时会同时更正为企业全称。</p>}
          <ul>
            {LOOKUP_FIELDS.map(({ key, label }) => {
              const value = lookupResult.company[key];
              if (value === null || value === undefined || value === '') return null;
              return <li key={key}><span>{label}</span><b>{String(value)}</b></li>;
            })}
          </ul>
          <div className="workspace-actions">
            <button type="button" className="admin-primary" disabled={busy} onClick={() => applyLookup('empty')}>填入空字段</button>
            <button type="button" className="admin-secondary" disabled={busy} onClick={() => applyLookup('overwrite')}>全部覆盖</button>
            <button type="button" className="workspace-op neutral" disabled={busy} onClick={() => setLookupResult(null)}>关闭</button>
          </div>
          <small>数据来自快查（查询时间 {new Date(lookupResult.lookup_at).toLocaleString('zh-CN')}）。电话、邮箱、官网不在该接口返回范围内，仍需手工填写。</small>
        </div>}
        <label>所属园区<select value={editing.park || ''} disabled={parkOnly || buildingOnly} onChange={e => set('park', e.target.value || null)}><option value="">未归入园</option>{editing.park && !parkNames.includes(editing.park) && <option value={editing.park}>{editing.park}</option>}{parkNames.map(name => <option key={name} value={name}>{name}</option>)}</select>{buildingOnly && <small>由所选楼栋的片区自动确定。</small>}</label>
        {buildingOnly ? <label>所属楼栋<span aria-hidden="true">*</span><select required value={editing.building_id || ''} onChange={e => chooseBuilding(e.target.value)}><option value="" disabled>请选择你负责的楼栋</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><small>企业会出现在这栋楼的楼层导览里。</small></label> : <>
          <label>关联楼栋<select value={editing.building_id || ''} onChange={e => chooseBuilding(e.target.value)}><option value="">不关联（按楼栋名称匹配）</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><small>选择后，前台按楼栋 ID 归楼，改名也不影响。</small></label>
          <label>楼栋名称<input value={text('building')} onChange={e => set('building', e.target.value)} maxLength={60}/></label>
        </>}
        <label>房号<input value={text('room')} onChange={e => set('room', e.target.value)} maxLength={60}/></label>
        <label>楼层<input value={text('floor')} onChange={e => set('floor', e.target.value)} maxLength={30} placeholder="例如 12F、12楼、B1"/><small>楼栋导览按楼层归位；同一栋楼请统一写法。</small></label>
        <label>所属行业<input value={text('industry')} onChange={e => set('industry', e.target.value)} maxLength={120}/></label>
        <label>经营状态<input value={text('status')} onChange={e => set('status', e.target.value)} maxLength={40} placeholder="存续 / 在业 / 注销"/></label>
        <label>成立日期<input type="date" value={text('established_on')} onChange={e => set('established_on', e.target.value || null)}/></label>
        <label>注册资本（万元）<input type="number" min="0" step="0.01" value={text('registered_capital')} onChange={e => set('registered_capital', e.target.value === '' ? null : Number(e.target.value))}/></label>
        <label>参保人数<input type="number" min="0" step="1" value={text('social_insurance_count')} onChange={e => set('social_insurance_count', e.target.value === '' ? null : Number(e.target.value))}/><small>前台不显示具体数字，只显示区间。</small></label>
        <label>人数区间<input value={text('employee_band')} onChange={e => set('employee_band', e.target.value)} maxLength={40} placeholder="留空则按参保人数自动换算"/></label>
        <label>法定代表人<input value={text('legal_representative')} onChange={e => set('legal_representative', e.target.value)} maxLength={60}/><small>前台显示为「张**」。</small></label>
        <label>联系电话<input value={text('phone')} onChange={e => set('phone', e.target.value)} maxLength={40}/><small>前台显示为「138****5678」。</small></label>
        <label>邮箱<input type="email" value={text('email')} onChange={e => set('email', e.target.value)} maxLength={120}/></label>
        <label>统一社会信用代码<input value={text('unified_code')} onChange={e => set('unified_code', e.target.value)} maxLength={32}/></label>
        <label>注册地址<input value={text('address')} onChange={e => set('address', e.target.value)} maxLength={300}/></label>
        <label>官网<input value={text('website')} onChange={e => set('website', e.target.value)} maxLength={200} placeholder="https://"/></label>
        <label>标签<input value={editing.tags.join('、')} onChange={e => set('tags', e.target.value.split(/[、,，;；]/).map(s => s.trim()).filter(Boolean))} placeholder="高新技术企业、专精特新"/></label>
        <label className="admin-check"><input type="checkbox" checked={editing.published} onChange={e => set('published', e.target.checked)}/> 在前台展示</label>
        <label className="admin-wide">经营范围<textarea rows={4} value={text('business_scope')} onChange={e => set('business_scope', e.target.value)} maxLength={4000}/></label>
      </fieldset>
      {error && <div className="admin-error" role="alert">{error}</div>}
      <div className="admin-actions">
        <button className="admin-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="feedback-spinner" size={18}/> : <CheckCircle2 size={18}/>} {busy ? '保存中…' : '保存'}</button>
      </div>
    </form>;
  }

  return <div className="workspace-stack">
    <div className="workspace-toolbar">
      <label className="workspace-search"><Search size={18}/><input aria-label="搜索企业" placeholder="搜索企业名称 / 行业 / 法人 / 地址" value={keyword} onChange={e => { setKeyword(e.target.value); setVisible(PAGE); }}/></label>
      {!parkOnly && !buildingOnly && <label className="workspace-park-filter"><span className="sr-only">按园区筛选</span><select value={parkFilter} onChange={e => { setParkFilter(e.target.value); setVisible(PAGE); }}><option value="">全部园区</option>{parkNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
      {buildingOnly && buildings.length > 1 && <label className="workspace-park-filter"><span className="sr-only">按楼栋筛选</span><select value={buildingFilter} onChange={e => { setBuildingFilter(e.target.value); setVisible(PAGE); }}><option value="">全部负责楼栋</option>{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
      <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={e => void chooseFile(e.target.files)}/>
      {!buildingOnly && <button className="admin-secondary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <LoaderCircle className="feedback-spinner" size={16}/> : <Upload size={18}/>} 导入 Excel / CSV</button>}
      <button className="admin-secondary" type="button" disabled={busy || !filtered.length} onClick={exportAll}><Download size={18}/> 导出</button>
      <button className="admin-primary" type="button" disabled={busy} onClick={startNew}><Plus size={18}/> 新增企业</button>
    </div>
    {message && <div className="admin-message success-note"><CheckCircle2 className="success-check"/><span>{message}</span></div>}
    {error && <div className="admin-error" role="alert">{error}</div>}
    <div className="workspace-card">
      <div className="workspace-card-heading"><h2>企业名录</h2><span className="workspace-help">共 {filtered.length} 家{keyword || parkFilter ? '（已筛选）' : ''} · 前台看到的是打码后的版本</span></div>
      {filtered.length === 0 ? <div className="admin-empty">{buildingOnly ? '这栋楼还没有企业资料。点「新增企业」逐家录入；批量导入请让超级管理员操作。' : '还没有企业数据。可以点「导入 Excel / CSV」批量导入，或「新增企业」逐家录入。'}</div> : <>
        <div className="visitor-table-scroll" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <table className="visitor-table">
            <thead><tr><th>企业名称</th><th>园区</th>{buildingOnly && <th>楼栋</th>}<th>行业</th><th>状态</th><th>法人</th><th>电话</th><th>操作</th></tr></thead>
            <tbody>{filtered.slice(0, visible).map(item => <tr key={item.id}>
              <td>{item.name}{item.tags.length > 0 && <small>{item.tags.join('、')}</small>}</td>
              <td>{item.park || '—'}</td>
              {buildingOnly && <td>{item.building || '—'}{item.floor && <small>{item.floor}</small>}</td>}
              <td>{item.industry || '—'}</td>
              <td data-nowrap>{item.status || '—'}</td>
              <td>{item.legal_representative || '—'}</td>
              <td data-nowrap>{item.phone || '—'}</td>
              <td data-nowrap className="workspace-actions">
                <button className="workspace-op" type="button" disabled={busy} onClick={() => { setEditing({ ...item }); setMessage(''); setError(''); setLookupResult(null); }}>编辑</button>
                <button className="workspace-op danger" type="button" disabled={busy} onClick={() => void remove(item)}><Trash2 size={14}/></button>
              </td>
            </tr>)}</tbody>
          </table>
        </div>
        {visible < filtered.length && <div className="workspace-actions"><button className="admin-secondary" type="button" onClick={() => setVisible(v => v + PAGE)}>再显示 {Math.min(PAGE, filtered.length - visible)} 家（还剩 {filtered.length - visible}）</button></div>}
      </>}
    </div>
  </div>;
}
