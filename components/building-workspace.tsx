'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, Download, ImagePlus, LoaderCircle, Plus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { uploadMedia } from '@/lib/backend';
import { downloadCsv, loadDirectory, type AdminEntry, type Park } from '@/lib/admin-workspace';
import { readTableFile } from '@/lib/sheet-read';
import {
  blankBuilding, blankUnit, deleteBuilding, deleteBuildingUnit, deleteBuildingUnitsOfBuilding,
  loadBuildingUnits, loadBuildings, saveBuilding, saveBuildingUnit, saveBuildingUnits,
  unitKey, type Building, type BuildingInput, type BuildingUnit, type BuildingUnitInput,
} from '@/lib/buildings';
import { parseUnitSheet, UNIT_IMPORT_COLUMNS, unitCsvRows, type ParsedUnitSheet } from '@/lib/building-import';
import type { RowIssue } from '@/lib/company-import';

type Props = {
  parks: Park[];
  assignedPark: string | null;
  onBusy: (busy: boolean) => void;
  /** 超级管理员和全园区管理员可以新建楼栋（数据库里也是同一规则）。 */
  canCreate: boolean;
  /** 删除整栋楼只允许超级管理员和全园区管理员。 */
  canDelete: boolean;
  /** 只有超级管理员能指定每栋楼的负责人。 */
  canAssign: boolean;
  /** 楼栋管理员：只能看到自己负责的楼栋。 */
  buildingOnly?: boolean;
};

const detail = (e: unknown) => (e instanceof Error ? e.message : '操作未完成，请重试。');
const statusLabel = (status: BuildingUnit['status']) => status === 'occupied' ? '已租（前台按企业记录展示）' : status === 'reserved' ? '预留' : '空置';

export function BuildingWorkspace({ parks, assignedPark, onBusy, canCreate, canDelete, canAssign, buildingOnly = false }: Props) {
  const [list, setList] = useState<Building[]>([]);
  const [managers, setManagers] = useState<AdminEntry[]>([]);
  const [units, setUnits] = useState<BuildingUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BuildingInput | null>(null);
  const [unitBuilding, setUnitBuilding] = useState<Building | null>(null);
  const [unitEditing, setUnitEditing] = useState<BuildingUnitInput | null>(null);
  const [preview, setPreview] = useState<(ParsedUnitSheet & { fileName: string; skippedSheets: string[] }) | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [buildings, allUnits] = await Promise.all([loadBuildings(), loadBuildingUnits()]);
      setList(buildings);
      setUnits(allUnits);
    } catch (e) { setError(detail(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!canAssign) return;
    loadDirectory()
      .then((rows) => setManagers(rows.filter((row) => row.active && row.role === 'building_admin')))
      .catch(() => setManagers([]));
  }, [canAssign]);

  function lock(value: boolean) { setBusy(value); onBusy(value); }

  const buildingUnits = (id: string) => units.filter((unit) => unit.building_id === id);
  const regionOptions = [...new Set([...parks.filter((p) => p.active).map((p) => p.name), ...(assignedPark ? [assignedPark] : [])])];

  function startNew() {
    setEditing({ ...blankBuilding(), region: assignedPark || null });
    setMessage(''); setError('');
  }

  async function submitBuilding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    if (editing.name.trim().length < 2) { setError('楼栋名称至少 2 个字，请填写完整名称，例如「环宇生物科技大厦」。'); return; }
    lock(true); setError(''); setMessage('');
    try {
      const saved = await saveBuilding(editing);
      await refresh();
      setEditing(null);
      setMessage(editing.id
        ? `「${saved.name}」资料已保存。`
        : `已创建「${saved.name}」。下一步点「管理空置单元」导入空置清单；企业楼层可在「企业」页导入或逐家编辑。`);
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  async function removeBuilding(building: Building) {
    const count = buildingUnits(building.id).length;
    if (!window.confirm(`删除「${building.name}」？${count ? `楼内 ${count} 条空置单元会一起删除，` : ''}此操作不可恢复。企业名录里的企业不会被删除。`)) return;
    lock(true); setError(''); setMessage('');
    try {
      await deleteBuilding(building.id);
      await refresh();
      setMessage(`已删除「${building.name}」。`);
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  async function uploadCover(files: FileList | null) {
    const file = files?.[0];
    if (!file || !editing || coverBusy) return;
    if (!file.type.startsWith('image/')) { setError('请选择 JPG、PNG 或 WebP 图片。'); return; }
    setCoverBusy(true); setError('');
    try {
      const url = await uploadMedia(file);
      setEditing((current) => current ? { ...current, cover_url: url } : current);
      setMessage('封面已上传，保存楼栋资料后生效。');
    } catch (e) { setError(detail(e)); }
    finally { setCoverBusy(false); if (coverInput.current) coverInput.current.value = ''; }
  }

  /* ---------------- 空置单元 ---------------- */
  function startUnit() {
    if (!unitBuilding) return;
    setUnitEditing(blankUnit(unitBuilding.id));
    setMessage(''); setError('');
  }

  async function submitUnit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unitEditing || busy) return;
    if (!unitEditing.floor.trim()) { setError('楼层不能为空。'); return; }
    lock(true); setError(''); setMessage('');
    try {
      const saved = await saveBuildingUnit(unitEditing);
      await refresh();
      setUnitEditing(null);
      setMessage(`${saved.floor}${saved.room ? ' · ' + saved.room : '（整层）'} 已保存。`);
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  async function removeUnit(unit: BuildingUnit) {
    if (!window.confirm(`删除 ${unit.floor}${unit.room ? ' · ' + unit.room : ''} 这条单元记录？`)) return;
    lock(true); setError(''); setMessage('');
    try {
      await deleteBuildingUnit(unit.id);
      await refresh();
      setMessage('单元已删除。');
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  function downloadTemplate() {
    downloadCsv('空置单元导入模板.csv', [...UNIT_IMPORT_COLUMNS], [
      ['12F', '1201', '120', '35', '8', '南', '精装', '空置', '采光好，可随时看房'],
      ['12F', '1202', '86', '33', '8', '东南', '简装', '空置', ''],
      ['15F', '', '680', '28', '6', '', '毛坯', '空置', '整层，可分割'],
    ]);
    setMessage('模板已下载。楼层写法请统一，例如 12F、12楼 或 B1；房号留空表示整层。');
  }

  function exportUnits() {
    if (!unitBuilding) return;
    const rows = unitCsvRows(buildingUnits(unitBuilding.id));
    if (!rows.length) { setError('这栋楼还没有单元记录。'); return; }
    const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    downloadCsv(`${unitBuilding.name}-空置单元-${date}.csv`, [...UNIT_IMPORT_COLUMNS], rows);
  }

  async function chooseFile(files: FileList | null) {
    const file = files?.[0];
    if (!file || !unitBuilding) return;
    setError(''); setMessage(''); setPreview(null);
    lock(true);
    try {
      const table = await readTableFile(file);
      const parsed = parseUnitSheet(table.rows, unitBuilding.id);
      if (!parsed.units.length) {
        setError(parsed.issues[0]?.message || '文件里没有可导入的单元。');
        return;
      }
      setPreview({ ...parsed, fileName: file.name, skippedSheets: table.skippedSheets });
      setImportMode('merge');
    } catch (e) { setError(detail(e)); }
    finally { lock(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function confirmImport() {
    if (!preview || !unitBuilding || busy) return;
    const existing = new Map(buildingUnits(unitBuilding.id).filter((unit) => unit.room).map((unit) => [unitKey(unit.floor, unit.room), unit]));
    if (importMode === 'replace' && !window.confirm(`先清空「${unitBuilding.name}」现有的 ${buildingUnits(unitBuilding.id).length} 条单元，再导入 ${preview.units.length} 条？这会删除现有记录，确定继续？`)) return;
    lock(true); setError(''); setMessage('');
    try {
      if (importMode === 'replace') await deleteBuildingUnitsOfBuilding(unitBuilding.id);
      const inserts: BuildingUnitInput[] = [];
      const updates: BuildingUnitInput[] = [];
      let duplicated = 0;
      for (const row of preview.units) {
        const { __row, ...data } = row;
        const hit = importMode === 'merge' && data.room ? existing.get(unitKey(data.floor, data.room)) : undefined;
        if (hit) updates.push({ ...data, id: hit.id });
        else inserts.push(data);
      }
      if (!inserts.length && !updates.length) {
        setError(`这 ${preview.units.length} 条都已存在（同楼层同房号），没有需要写入的数据。`);
        return;
      }
      const chunks = <T,>(arr: T[]) => arr.reduce<T[][]>((acc, x, i) => { if (i % 100 === 0) acc.push([]); acc[acc.length - 1].push(x); return acc; }, []);
      for (const chunk of chunks(inserts)) await saveBuildingUnits(chunk);
      for (const chunk of chunks(updates)) await saveBuildingUnits(chunk);
      await refresh();
      setPreview(null);
      setMessage(importMode === 'replace'
        ? `已清空旧记录并导入 ${preview.units.length} 条单元。`
        : `导入完成：新增 ${inserts.length} 条，更新 ${updates.length} 条${duplicated ? `，跳过重复 ${duplicated} 条` : ''}。`);
    } catch (e) { setError(detail(e)); }
    finally { lock(false); }
  }

  if (loading) return <div className="workspace-card admin-empty"><LoaderCircle className="feedback-spinner" size={20}/> 正在读取楼栋资料…</div>;

  /* ---------------- 导入预览 ---------------- */
  if (preview && unitBuilding) {
    const existingUnits = buildingUnits(unitBuilding.id);
    const conflict = preview.units.filter((unit) => unit.room && existingUnits.some((row) => unitKey(row.floor, row.room) === unitKey(unit.floor, unit.room))).length;
    const blocked = preview.issues.filter((issue) => issue.blocking);
    const warnings = preview.issues.filter((issue) => !issue.blocking);
    const occupied = preview.units.filter((unit) => unit.status === 'occupied').length;
    return <div className="workspace-stack">
      <div className="workspace-card">
        <div className="workspace-card-heading"><h2>导入预览：{preview.fileName}</h2><button type="button" disabled={busy} onClick={() => setPreview(null)}><X size={16}/> 返回单元列表</button></div>
        <p className="workspace-help">读到 {preview.units.length} 条单元；其中 {conflict} 条与「{unitBuilding.name}」现有记录同楼层同房号。{preview.skippedSheets.length > 0 && ` 只读取了第一个工作表，其余 ${preview.skippedSheets.length} 个未导入。`}</p>
        {occupied > 0 && <p className="workspace-notice">有 {occupied} 条标记为「已租」。它们会保存，但前台楼层导览不会展示；已入驻企业请写在「企业」页，这样鼠标移上去才能看到企业资料。</p>}
        {preview.unknownHeaders.length > 0 && <p className="workspace-help">未识别的列（会被忽略）：{preview.unknownHeaders.join('、')}</p>}
        {blocked.length > 0 && <div className="admin-error" role="alert">有 {blocked.length} 行未通过校验，不会导入：<ul>{blocked.slice(0, 10).map((issue: RowIssue, i) => <li key={i}>第 {issue.row} 行 · {issue.field}：{issue.message}</li>)}{blocked.length > 10 && <li>……其余 {blocked.length - 10} 行略。</li>}</ul></div>}
        {warnings.length > 0 && <div className="workspace-notice" role="status">另有 {warnings.length} 处提醒，这些行照常导入：<ul>{warnings.slice(0, 5).map((issue: RowIssue, i) => <li key={i}>第 {issue.row} 行 · {issue.field}：{issue.message}</li>)}</ul></div>}
        <fieldset disabled={busy} className="workspace-chips" style={{ marginTop: 12 }}>
          <legend className="workspace-help">怎么处理同楼层同房号的记录？</legend>
          <button type="button" className={importMode === 'merge' ? 'active' : ''} onClick={() => setImportMode('merge')}>追加 / 更新同房号（推荐）</button>
          <button type="button" className={importMode === 'replace' ? 'active' : ''} onClick={() => setImportMode('replace')}>先清空这栋楼再导入</button>
        </fieldset>
        <div className="workspace-actions" style={{ marginTop: 16 }}>
          <button className="admin-primary" type="button" disabled={busy || !preview.units.length} onClick={() => void confirmImport()}>
            {busy ? <LoaderCircle className="feedback-spinner" size={18}/> : <Upload size={18}/>} {busy ? '正在写入…' : '确认导入'}
          </button>
        </div>
        <div className="visitor-table-scroll" style={{ maxHeight: '50vh', overflow: 'auto', marginTop: 16 }}>
          <table className="visitor-table">
            <thead><tr><th>行</th><th>楼层</th><th>房号</th><th>面积</th><th>租金</th><th>物业费</th><th>状态</th><th>备注</th></tr></thead>
            <tbody>{preview.units.slice(0, 200).map((unit) => <tr key={unit.__row}>
              <td data-nowrap>{unit.__row}</td><td data-nowrap>{unit.floor}</td><td>{unit.room || '整层'}</td>
              <td data-nowrap>{unit.area == null ? '—' : `${unit.area}㎡`}</td><td data-nowrap>{unit.rent == null ? '面议' : unit.rent}</td>
              <td data-nowrap>{unit.fee == null ? '—' : unit.fee}</td><td data-nowrap>{statusLabel(unit.status)}</td><td>{unit.note || '—'}</td>
            </tr>)}</tbody>
          </table>
          {preview.units.length > 200 && <p className="workspace-help">仅预览前 200 行，实际会全部导入。</p>}
        </div>
      </div>
    </div>;
  }

  /* ---------------- 楼栋编辑 ---------------- */
  if (editing) {
    const set = <K extends keyof BuildingInput>(key: K, value: BuildingInput[K]) => setEditing((cur) => cur ? { ...cur, [key]: value } : cur);
    const text = (key: keyof BuildingInput) => (editing[key] == null ? '' : String(editing[key]));
    return <form className="admin-editor" onSubmit={submitBuilding} noValidate>
      <div className="admin-editor-heading"><div><h2>{editing.id ? '编辑楼栋' : '新增楼栋'}</h2><p>首页只展示「已发布」的楼栋。空置单元和入驻企业都准备好后再发布。</p></div><button type="button" disabled={busy} onClick={() => setEditing(null)}>返回列表</button></div>
      <fieldset className="admin-fields" disabled={busy}>
        <div className="admin-form-grid">
          <label>楼栋名称<span aria-hidden="true">*</span><input required value={text('name')} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="例如 环宇生物科技大厦"/></label>
          <label>所属片区<input list="building-region-options" value={text('region')} onChange={(e) => set('region', e.target.value || null)} maxLength={120} placeholder="例如 松山湖北部"/><datalist id="building-region-options">{regionOptions.map((name) => <option key={name} value={name}/>)}</datalist></label>
          <label>详细地址<input value={text('address')} onChange={(e) => set('address', e.target.value || null)} maxLength={300}/></label>
          <label>总楼层数<input type="number" min="1" max="200" value={text('floors_count')} onChange={(e) => set('floors_count', e.target.value === '' ? null : Number(e.target.value))}/></label>
          {canAssign && <label>楼栋负责人<select value={editing.manager_id || ''} onChange={(e) => set('manager_id', e.target.value || null)}><option value="">暂不指定</option>{managers.map((admin) => <option key={admin.user_id} value={admin.user_id}>{admin.display_name || admin.email}</option>)}</select><small>{managers.length ? '只有被指定的负责人能维护这栋楼；超级管理员和全园区管理员不受限制。' : '还没有楼栋管理员账号。请先到「设置 → 管理员账号」新增，管理范围选「楼栋管理员」。'}</small></label>}
          <label>排序（数字越小越靠前）<input type="number" value={text('sort_order')} onChange={(e) => set('sort_order', e.target.value === '' ? 0 : Number(e.target.value))}/></label>
          <label className="admin-check"><input type="checkbox" checked={editing.published} onChange={(e) => set('published', e.target.checked)}/> 在首页展示这栋楼</label>
          <label className="admin-wide">封面图地址<input value={text('cover_url')} onChange={(e) => set('cover_url', e.target.value || null)} maxLength={1000} placeholder="可上传，也可粘贴图片网址"/></label>
        </div>
        <div className="lookup-row">
          <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => void uploadCover(e.target.files)}/>
          <button type="button" className="admin-secondary" disabled={busy || coverBusy} onClick={() => coverInput.current?.click()}>
            {coverBusy ? <LoaderCircle className="feedback-spinner" size={16}/> : <ImagePlus size={16}/>} {coverBusy ? '正在上传…' : '上传封面'}
          </button>
          <small>建议横图，宽高比约 16:9。不传封面时，前台会用楼栋名称生成简洁色块。</small>
        </div>
        {editing.cover_url && <div className="building-cover-preview"><img src={editing.cover_url} alt="楼栋封面预览"/></div>}
        <div className="admin-form-grid">
          <label className="admin-wide">楼栋简介<textarea rows={4} value={text('description')} onChange={(e) => set('description', e.target.value || null)} maxLength={4000} placeholder="位置、产业定位、配套、交付标准等"/></label>
          <label className="admin-wide">亮点标签<input value={editing.highlights.join('、')} onChange={(e) => set('highlights', e.target.value.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean))} placeholder="地铁旁、可办环评、拎包入住"/></label>
        </div>
      </fieldset>
      {error && <div className="admin-error" role="alert">{error}</div>}
      <div className="admin-actions">
        <button className="admin-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="feedback-spinner" size={18}/> : <CheckCircle2 size={18}/>} {busy ? '保存中…' : '保存楼栋'}</button>
      </div>
    </form>;
  }

  /* ---------------- 某栋楼的单元列表 ---------------- */
  if (unitBuilding) {
    const rows = buildingUnits(unitBuilding.id).slice().sort((a, b) => (b.floor_no ?? -999) - (a.floor_no ?? -999) || String(a.room || '').localeCompare(String(b.room || ''), 'zh-Hans-CN'));
    const vacant = rows.filter((unit) => unit.status === 'vacant');
    const area = vacant.reduce((sum, unit) => sum + (unit.area || 0), 0);
    const set = <K extends keyof BuildingUnitInput>(key: K, value: BuildingUnitInput[K]) => setUnitEditing((cur) => cur ? { ...cur, [key]: value } : cur);
    const text = (key: keyof BuildingUnitInput) => (unitEditing && unitEditing[key] == null ? '' : String(unitEditing?.[key] ?? ''));
    return <div className="workspace-stack">
      <div className="workspace-toolbar" style={{ flexWrap: 'wrap' }}>
        <div className="workspace-card-heading" style={{ margin: 0, flex: 1, minWidth: 240, justifyContent: 'flex-start' }}><button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }} disabled={busy} onClick={() => { setUnitBuilding(null); setUnitEditing(null); setPreview(null); }}><ArrowLeft size={16}/> 返回楼栋</button><h2 style={{ margin: 0 }}>{unitBuilding.name}</h2></div>
        <input ref={fileInput} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={(e) => void chooseFile(e.target.files)}/>
        <button className="admin-secondary" type="button" disabled={busy} onClick={downloadTemplate}><Download size={16}/> 模板</button>
        <button className="admin-secondary" type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16}/> 导入空置清单</button>
        <button className="admin-secondary" type="button" disabled={busy || !rows.length} onClick={exportUnits}><Download size={16}/> 导出</button>
        <button className="admin-primary" type="button" disabled={busy} onClick={startUnit}><Plus size={16}/> 新增单元</button>
      </div>
      {message && <div className="admin-message success-note"><CheckCircle2 className="success-check"/><span>{message}</span></div>}
      {error && <div className="admin-error" role="alert">{error}</div>}

      {unitEditing && <form className="workspace-card" onSubmit={submitUnit} noValidate>
        <div className="workspace-card-heading"><h2>{unitEditing.id ? '编辑单元' : '新增单元'}</h2><button type="button" disabled={busy} onClick={() => setUnitEditing(null)}><X size={16}/> 取消</button></div>
        <fieldset className="admin-fields" disabled={busy}>
          <div className="admin-form-grid">
            <label>楼层<span aria-hidden="true">*</span><input required value={text('floor')} onChange={(e) => set('floor', e.target.value)} maxLength={30} placeholder="12F / 12楼 / B1"/><small>排序会自动识别数字；同一栋楼请统一写法。</small></label>
            <label>房号<input value={text('room')} onChange={(e) => set('room', e.target.value || null)} maxLength={60} placeholder="1201；留空表示整层"/></label>
            <label>面积（㎡）<input type="number" min="0" step="0.01" value={text('area')} onChange={(e) => set('area', e.target.value === '' ? null : Number(e.target.value))}/></label>
            <label>租金单价（元/㎡·月）<input type="number" min="0" step="0.01" value={text('rent')} onChange={(e) => set('rent', e.target.value === '' ? null : Number(e.target.value))}/></label>
            <label>物业费（元/㎡·月）<input type="number" min="0" step="0.01" value={text('fee')} onChange={(e) => set('fee', e.target.value === '' ? null : Number(e.target.value))}/></label>
            <label>朝向<input value={text('orientation')} onChange={(e) => set('orientation', e.target.value || null)} maxLength={30} placeholder="南 / 东南 / 双向采光"/></label>
            <label>装修<input value={text('decoration')} onChange={(e) => set('decoration', e.target.value || null)} maxLength={60} placeholder="精装 / 简装 / 毛坯"/></label>
            <label>状态<select value={unitEditing.status} onChange={(e) => set('status', e.target.value as BuildingUnitInput['status'])}><option value="vacant">空置（前台展示）</option><option value="reserved">预留（前台展示）</option><option value="occupied">已租（前台不展示）</option></select></label>
            <label className="admin-wide">备注<textarea rows={2} value={text('note')} onChange={(e) => set('note', e.target.value || null)} maxLength={1000}/></label>
            <label className="admin-check"><input type="checkbox" checked={unitEditing.published} onChange={(e) => set('published', e.target.checked)}/> 前台展示这条单元</label>
          </div>
        </fieldset>
        <div className="admin-actions"><button className="admin-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="feedback-spinner" size={18}/> : <CheckCircle2 size={18}/>} {busy ? '保存中…' : '保存单元'}</button></div>
      </form>}

      <div className="workspace-card">
        <div className="workspace-card-heading"><h2>空置单元</h2><span className="workspace-help">共 {rows.length} 条 · 空置 {vacant.length} 条{vacant.length ? ` · 合计 ${area.toFixed(2).replace(/\.00$/, '')}㎡` : ''}</span></div>
        {rows.length === 0 ? <div className="admin-empty">还没有单元。点「导入空置清单」批量导入，或「新增单元」逐条录入。导入前可先下载模板。</div> : <div className="visitor-table-scroll" style={{ maxHeight: '60vh', overflow: 'auto' }}>
          <table className="visitor-table">
            <thead><tr><th>楼层</th><th>房号</th><th>面积</th><th>租金</th><th>物业费</th><th>朝向 / 装修</th><th>状态</th><th>备注</th><th>操作</th></tr></thead>
            <tbody>{rows.map((unit) => <tr key={unit.id}>
              <td data-nowrap>{unit.floor}{unit.floor_no === null && <small>无法识别层数</small>}</td>
              <td>{unit.room || '整层'}</td>
              <td data-nowrap>{unit.area == null ? '—' : `${unit.area}㎡`}</td>
              <td data-nowrap>{unit.rent == null ? '面议' : `${unit.rent} 元`}</td>
              <td data-nowrap>{unit.fee == null ? '—' : `${unit.fee} 元`}</td>
              <td>{[unit.orientation, unit.decoration].filter(Boolean).join(' · ') || '—'}</td>
              <td data-nowrap>{statusLabel(unit.status)}</td>
              <td>{unit.note || '—'}</td>
              <td data-nowrap className="workspace-actions">
                <button className="workspace-op" type="button" disabled={busy} onClick={() => { setUnitEditing({ ...unit }); setMessage(''); setError(''); }}>编辑</button>
                <button className="workspace-op danger" type="button" disabled={busy} onClick={() => void removeUnit(unit)}><Trash2 size={14}/></button>
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
    </div>;
  }

  /* ---------------- 楼栋列表 ---------------- */
  const totalVacant = units.filter((unit) => unit.status === 'vacant').length;
  return <div className="workspace-stack">
    {buildingOnly && <p className="workspace-notice">你只能看到并维护自己负责的楼栋、楼内空置单元，以及关联到这栋楼的企业。需要调整负责人时请联系超级管理员。</p>}
    <div className="workspace-toolbar">
      <p className="workspace-help" style={{ margin: 0, flex: 1 }}>楼栋导览先建楼，再导入空置清单；企业楼层在「企业」页维护。首页只展示已发布的楼栋。</p>
      <button className="admin-secondary" type="button" disabled={busy} onClick={() => { setError(''); setMessage(''); void refresh(); }}><RefreshCw size={16}/> 刷新</button>
      {canCreate && <button className="admin-primary" type="button" disabled={busy} onClick={startNew}><Plus size={18}/> 新增楼栋</button>}
    </div>
    {message && <div className="admin-message success-note"><CheckCircle2 className="success-check"/><span>{message}</span></div>}
    {error && <div className="admin-error" role="alert">{error}</div>}
    <div className="workspace-card">
      <div className="workspace-card-heading"><h2><Building2 size={18}/>楼栋</h2><span className="workspace-help">共 {list.length} 栋 · 空置单元 {totalVacant} 条</span></div>
      {list.length === 0 ? <div className="admin-empty">{canCreate ? '还没有楼栋。点右上「新增楼栋」，先建「环宇生物科技大厦」，再导入空置清单。' : '还没有分配给你的楼栋。请联系超级管理员，在「楼栋」→ 编辑 → 楼栋负责人里选择你。'}</div> : <div className="visitor-table-scroll">
        <table className="visitor-table">
          <thead><tr><th>楼栋名称</th><th>片区</th><th>总层数</th><th>空置单元</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{list.map((building) => {
            const own = buildingUnits(building.id);
            return <tr key={building.id}>
              <td>{building.name}{building.address && <small>{building.address}</small>}{canAssign && <small>{building.manager_id ? `负责人：${managers.find((admin) => admin.user_id === building.manager_id)?.display_name || managers.find((admin) => admin.user_id === building.manager_id)?.email || '已指定'}` : '负责人：未指定'}</small>}</td>
              <td>{building.region || '—'}</td>
              <td data-nowrap>{building.floors_count ? `${building.floors_count} 层` : '—'}</td>
              <td data-nowrap>{own.filter((unit) => unit.status === 'vacant').length} 条{own.length > 0 && <small>共录入 {own.length} 条</small>}</td>
              <td data-nowrap><span className={`workspace-status ${building.published ? 'replied' : 'neutral'}`}>{building.published ? '已发布' : '未发布'}</span></td>
              <td data-nowrap className="workspace-actions">
                <button className="workspace-op" type="button" disabled={busy} onClick={() => { setEditing({ ...building }); setMessage(''); setError(''); }}>编辑</button>
                <button className="workspace-op" type="button" disabled={busy} onClick={() => { setUnitBuilding(building); setUnitEditing(null); setPreview(null); setMessage(''); setError(''); }}>管理空置单元</button>
                {canDelete && <button className="workspace-op danger" type="button" disabled={busy} onClick={() => void removeBuilding(building)}><Trash2 size={14}/></button>}
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </div>
  </div>;
}
