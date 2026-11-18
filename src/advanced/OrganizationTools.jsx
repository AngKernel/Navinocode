import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useWorkspaceStore } from './useWorkspaceStore';
import { importBookmarkRows, moveAppsAcrossWorkspaces } from './storage.js';
import { IMPORT_FILE_BYTES, parseBookmarkFile, previewBookmarkImport, previewTransfer, readBrowserBookmarks } from './organization.js';
import { extensionAvailable } from './browserApi.js';
import { previewSignature } from './snapshotDiff.js';

const selectClass = 'mt-1 block w-full min-w-0 rounded-xl border bg-background p-2 text-sm';
const TargetFields = ({ state, workspaceId, folderId, onWorkspace, onFolder, prefix, exclude }) => <div className="grid gap-3 sm:grid-cols-2">
  <label className="min-w-0 text-sm">目标工作区<select aria-label={`${prefix}目标工作区`} className={selectClass} value={workspaceId} onChange={(event) => onWorkspace(event.target.value)}>
    {state.workspaces.filter((ws) => ws.id !== exclude).map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
  </select></label>
  <label className="min-w-0 text-sm">目标文件夹<select aria-label={`${prefix}目标文件夹`} className={selectClass} value={folderId} onChange={(event) => onFolder(event.target.value)}>
    <option value="">未分组</option>{state.workspaces.find((ws) => ws.id === workspaceId)?.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
  </select></label>
</div>;

const OrganizationTools = ({ workspaceId, selectedIds = [], onMoved }) => {
  const state = useWorkspaceStore();
  const [moveOpen, setMoveOpen] = useState(false); const [moveIds, setMoveIds] = useState([]);
  const [moveTarget, setMoveTarget] = useState(''); const [moveFolder, setMoveFolder] = useState('');
  const [keepMoveDuplicates, setKeepMoveDuplicates] = useState(false); const [moveConfirmed, setMoveConfirmed] = useState(false);
  const [importOpen, setImportOpen] = useState(false); const [rows, setRows] = useState([]);
  const [importTarget, setImportTarget] = useState(workspaceId); const [importFolder, setImportFolder] = useState('');
  const [preserveFolders, setPreserveFolders] = useState(true); const [keepDuplicates, setKeepDuplicates] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set()); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const input = useRef(null); const requestId = useRef(0);
  useEffect(() => { setMoveOpen(false); setImportOpen(false); requestId.current += 1; setBusy(false); }, [workspaceId]);
  useEffect(() => () => { requestId.current += 1; }, []);
  useEffect(() => setMoveConfirmed(false), [state, moveTarget, moveFolder, keepMoveDuplicates]);
  const movePlan = useMemo(() => {
    if (!moveOpen) return null;
    try { return previewTransfer(state, workspaceId, moveIds, moveTarget, moveFolder || null, keepMoveDuplicates ? 'keep' : 'skip'); }
    catch (e) { return { error: e.message }; }
  }, [state, workspaceId, moveOpen, moveIds, moveTarget, moveFolder, keepMoveDuplicates]);
  const importOptions = useMemo(() => ({ folderId: importFolder || null, preserveFolders, duplicatePolicy: keepDuplicates ? 'keep' : 'skip' }), [importFolder, preserveFolders, keepDuplicates]);
  const importPreview = useMemo(() => {
    try { return previewBookmarkImport(state, importTarget, rows, importOptions); } catch { return []; }
  }, [state, importTarget, rows, importOptions]);
  useEffect(() => {
    setSelectedRows(new Set(importPreview.filter((row) => row.status === 'new').map((row) => row.id)));
  }, [rows, importTarget, importOptions]);
  const eligible = importPreview.filter((row) => row.status === 'new');
  const chosen = eligible.filter((row) => selectedRows.has(row.id));
  const closeImport = (open) => { setImportOpen(open); if (!open) { requestId.current += 1; setBusy(false); } };
  const loadRows = async (operation) => {
    if (busy) return;
    const id = ++requestId.current; setBusy(true); setError('');
    try { const next = await operation(); if (id === requestId.current) { setRows(next); if (!next.length) setError('没有可导入的书签'); } }
    catch (e) { if (id === requestId.current) setError(e.message || '读取书签失败'); }
    finally { if (id === requestId.current) setBusy(false); }
  };
  const startImport = () => { setRows([]); setError(''); setImportTarget(workspaceId); setImportFolder(''); setKeepDuplicates(false); setPreserveFolders(true); setImportOpen(true); };
  const confirmImport = () => {
    try {
      const result = importBookmarkRows(importTarget, chosen, { ...importOptions, expectedSignature: previewSignature(state) });
      const name = state.workspaces.find((ws) => ws.id === importTarget)?.name || '';
      closeImport(false); toast(`已向“${name}”导入 ${result.imported} 个网站，跳过 ${result.skipped} 个`);
    } catch (e) { toast.error(e.message); }
  };
  return <>
    <div className="mb-3 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={startImport}>导入书签</Button>
      <Button type="button" variant="outline" size="sm" disabled={!selectedIds.length || state.workspaces.length < 2} onClick={() => {
        setMoveIds([...selectedIds]); setMoveTarget(state.workspaces.find((ws) => ws.id !== workspaceId)?.id || '');
        setMoveFolder(''); setKeepMoveDuplicates(false); setMoveConfirmed(false); setMoveOpen(true);
      }}>跨工作区移动（{selectedIds.length}）</Button>
    </div>
    <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-2xl">
        <DialogTitle>跨工作区批量移动</DialogTitle><DialogDescription>默认跳过重复网址并留在原工作区；移动前保存恢复点，所有选中项通过一次工作区状态提交完成。</DialogDescription>
        <TargetFields state={state} workspaceId={moveTarget} folderId={moveFolder} prefix="移动" exclude={workspaceId} onWorkspace={(id) => { setMoveTarget(id); setMoveFolder(''); }} onFolder={setMoveFolder} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={keepMoveDuplicates} onChange={(e) => setKeepMoveDuplicates(e.target.checked)} />目标已有相同网址时，仍保留一份新的副本</label>
        {movePlan?.error ? <p role="alert">{movePlan.error}</p> : movePlan && <>
          <p role="status" className="text-sm font-medium">将移动 {movePlan.moving.length} 个到“{movePlan.targetName} / {movePlan.folderName}”；{movePlan.skipped.length} 个留在原处。</p>
          <div className="max-h-[35vh] space-y-2 overflow-y-auto rounded-xl border p-3 text-sm">
            {movePlan.moving.map((app) => <p key={app.id} className="break-all">移动：{app.name} · {app.url}</p>)}
            {movePlan.skipped.map(({ app, reason }) => <p key={app.id} className="break-all text-muted-foreground">跳过：{app.name} · {reason}</p>)}
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={moveConfirmed} onChange={(e) => setMoveConfirmed(e.target.checked)} />我已检查移动目标与跳过项</label>
        </>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>取消</Button><Button type="button" disabled={!moveConfirmed || !movePlan?.moving?.length} onClick={() => {
          try {
            const result = moveAppsAcrossWorkspaces(workspaceId, moveIds, moveTarget, moveFolder || null, { duplicatePolicy: keepMoveDuplicates ? 'keep' : 'skip', expectedSignature: previewSignature(state) });
            setMoveOpen(false); onMoved?.(); toast(`已移动 ${result.moved} 个网站；可在工作区恢复历史中恢复`);
          } catch (e) { toast.error(e.message); }
        }}>确认移动网站</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={importOpen} onOpenChange={closeImport}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogTitle>书签导入预览</DialogTitle><DialogDescription>只向 Navinocode 添加网站，不修改浏览器书签。每批最多 1000 条；HTML/JSON 文件最大 2 MiB。</DialogDescription>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy || !extensionAvailable()} onClick={() => loadRows(readBrowserBookmarks)}>读取浏览器书签</Button><Button type="button" variant="outline" disabled={busy} onClick={() => input.current?.click()}>选择书签文件</Button></div>
        <input ref={input} type="file" aria-label="导入书签文件" accept=".html,.htm,.json" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          void loadRows(async () => { if (file.size > IMPORT_FILE_BYTES) throw new Error('书签文件最大为 2 MiB'); return parseBookmarkFile(await file.text()); });
        }} />
        <p className="text-xs text-muted-foreground">读取浏览器书签只申请 bookmarks 权限；Web 版可选择浏览器导出的书签 HTML 或 JSON。</p>
        {busy && <p role="status">正在读取书签…</p>}{error && <p role="alert">{error}</p>}
        <TargetFields state={state} workspaceId={importTarget} folderId={importFolder} prefix="导入" onWorkspace={(id) => { setImportTarget(id); setImportFolder(''); }} onFolder={setImportFolder} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={preserveFolders} disabled={Boolean(importFolder)} onChange={(e) => setPreserveFolders(e.target.checked)} />按原书签路径建立单层文件夹（路径以“/”连接；指定目标文件夹时全部放入该目录）</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={keepDuplicates} onChange={(e) => setKeepDuplicates(e.target.checked)} />保留重复网址的副本（默认跳过）</label>
        {!!rows.length && <>
          <p role="status" className="text-sm">可导入 {eligible.length} 条 · 重复 {importPreview.filter((row) => row.status === 'duplicate').length} 条 · 无效 {importPreview.filter((row) => row.status === 'invalid').length} 条</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="全选可导入书签" checked={eligible.length > 0 && chosen.length === eligible.length} onChange={(e) => setSelectedRows(new Set(e.target.checked ? eligible.map((row) => row.id) : []))} />全选可导入项</label>
          <div className="max-h-[34vh] space-y-2 overflow-y-auto rounded-xl border p-3">
            {importPreview.map((row) => <label key={row.id} className="flex min-w-0 items-start gap-2 border-b py-2 last:border-0">
              <input type="checkbox" aria-label={`导入 ${row.title}`} disabled={row.status !== 'new'} checked={row.status === 'new' && selectedRows.has(row.id)} onChange={(e) => setSelectedRows((previous) => { const next = new Set(previous); if (e.target.checked) next.add(row.id); else next.delete(row.id); return next; })} />
              <span className="min-w-0 break-all text-sm"><span className="block font-medium">{row.title}</span><span className="block text-xs text-muted-foreground">{row.url || '无效网址'} · {row.reason}</span><span className="block text-xs">目标：{row.destination}</span></span>
            </label>)}
          </div>
        </>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => closeImport(false)}>取消</Button><Button type="button" disabled={busy || !chosen.length} onClick={confirmImport}>导入选中 {chosen.length} 条书签</Button></div>
      </DialogContent>
    </Dialog>
  </>;
};
export default OrganizationTools;
