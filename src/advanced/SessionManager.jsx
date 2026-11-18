import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { captureCurrentWindow, deleteSession, previewSessionRestore, readSessions, restoreSession, saveSession, subscribeSessions, SESSION_KEY } from './browserSessions.js';
import { extensionAvailable } from './browserApi.js';
import { stableJSON } from './snapshotDiff.js';
import { downloadJSON, downloadText } from './dataUiUtils.js';

const SessionManager = ({ open, onOpenChange }) => {
  const [sessions, setSessions] = useState([]); const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState(''); const [draft, setDraft] = useState(null); const [name, setName] = useState('');
  const [selection, setSelection] = useState(new Set()); const [includeGroups, setIncludeGroups] = useState(true);
  const [target, setTarget] = useState('current'); const [group, setGroup] = useState(true); const [skipOpen, setSkipOpen] = useState(true);
  const [preview, setPreview] = useState(null); const [result, setResult] = useState(null); const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false); const locked = useRef(false); const generation = useRef(0); const controller = useRef(null);
  const active = draft || sessions.find((session) => session.id === selectedId);
  useEffect(() => {
    if (!open) return;
    const refresh = () => { try { setSessions(readSessions()); setError(''); } catch (e) { setError(e.message); } };
    refresh(); return subscribeSessions(refresh);
  }, [open]);
  useEffect(() => {
    setSelection(new Set(active?.tabs.map((tab) => tab.url) || [])); setPreview(null); setResult(null);
  }, [active?.id]);
  useEffect(() => () => { generation.current += 1; controller.current?.abort(); }, []);
  useEffect(() => { if (!open) { generation.current += 1; controller.current?.abort(); setBusy(false); } }, [open]);
  const execute = async (operation, success) => {
    if (locked.current) { setError('上次浏览器操作尚未结束，请在它结束后重试'); return; }
    locked.current = true; const id = ++generation.current; setBusy(true); setError('');
    try { const value = await operation(); if (id === generation.current) success?.(value); }
    catch (e) { if (id === generation.current) setError(e.message || '会话操作失败'); }
    finally { locked.current = false; if (id === generation.current) setBusy(false); }
  };
  const close = (next) => {
    if (!next) { controller.current?.abort(); generation.current += 1; setBusy(false); }
    onOpenChange(next);
  };
  const capture = () => execute(() => captureCurrentWindow({ includeGroups }), (value) => {
    setDraft({ ...value, id: `draft-${Date.now()}` }); setSelectedId('');
    setName(`工作会话 ${new Date().toLocaleString()}`); setResult(null);
  });
  const save = () => {
    try {
      const session = saveSession(name, draft.tabs.filter((tab) => selection.has(tab.url)));
      setDraft(null); setSelectedId(session.id); toast('会话已保存到本机');
    } catch (e) { setError(e.message); }
  };
  const createPreview = () => execute(() => previewSessionRestore(active, { selectedUrls: [...selection], skipOpen }), (plan) => {
    setPreview({ plan, session: active, signature: stableJSON(active), target, group, skipOpen }); setResult(null);
  });
  const confirmRestore = () => execute(async () => {
    const latest = readSessions().find((session) => session.id === preview.session.id);
    if (!latest || stableJSON(latest) !== preview.signature) throw new Error('保存的会话已变化，请重新预览');
    controller.current = new AbortController();
    return restoreSession(latest, { target: preview.target, group: preview.group, skipOpen: preview.skipOpen,
      selectedUrls: preview.plan.open.map((tab) => tab.url), signal: controller.current.signal });
  }, (value) => {
    setResult(value); setPreview(null);
    // A new-window retry cannot rely on the current-window URL query. Keep
    // only failed URLs selected so successful opens are never repeated.
    if (value.failed.length) setSelection(new Set(value.failed.map((item) => item.url)));
    toast(`已打开 ${value.opened.length} 个标签页，未关闭任何现有页面`);
  });
  return <>
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col overflow-y-auto rounded-2xl">
        <DialogTitle>工作会话</DialogTitle><DialogDescription>保存当前普通窗口的标签页；只在本机保存，不进入云同步或工作区恢复历史。最多 20 个会话、每个 250 页，合计 1 MiB。</DialogDescription>
        <div className="flex flex-wrap items-center gap-3"><Button type="button" disabled={busy || !extensionAvailable()} onClick={capture}>预览当前窗口</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeGroups} disabled={busy} onChange={(e) => setIncludeGroups(e.target.checked)} />读取分组名称（额外申请分组权限）</label></div>
        {!extensionAvailable() && <p className="text-xs text-muted-foreground">捕获和恢复标签页需要扩展版；Web 版只能查看或导出本机已有会话。</p>}
        {error && <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button type="button" size="sm" variant="ghost" onClick={() => { try { downloadText(localStorage.getItem(SESSION_KEY) || '{}', 'navinocode-sessions-raw.json'); } catch (e) { toast.error(e.message); } }}>导出原始会话数据</Button></div>}
        <div className="grid min-h-0 gap-4 md:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="max-h-64 space-y-2 overflow-y-auto rounded-xl border p-2 md:max-h-[55vh]" aria-label="已保存会话">
            {!sessions.length && <p className="p-2 text-sm text-muted-foreground">还没有保存的会话。</p>}
            {sessions.map((session) => <button key={session.id} type="button" disabled={busy} aria-pressed={!draft && selectedId === session.id} className={`block w-full rounded-lg p-2 text-left text-sm ${!draft && selectedId === session.id ? 'bg-muted' : 'hover:bg-muted/50'}`} onClick={() => { setDraft(null); setSelectedId(session.id); }}>
              <span className="block break-all font-medium">{session.name}</span><span className="text-xs text-muted-foreground">{session.tabs.length} 个标签页 · {new Date(session.createdAt).toLocaleDateString()}</span>
            </button>)}
          </aside>
          <main className="min-w-0 space-y-3">
            {!active ? <p className="py-8 text-center text-sm text-muted-foreground">选择已保存会话，或先预览当前窗口。</p> : <>
              {draft ? <><Input aria-label="会话名称" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="会话名称" />
                <p className="text-xs text-muted-foreground">已去重 {draft.duplicates} 页，排除内部页面或无效网址 {draft.excluded} 页；隐私窗口不会保存。</p></> :
                <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 flex-1 break-all font-medium">{active.name}</h3>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { try { downloadJSON({ version: 1, sessions: [active] }, `navinocode-session-${active.id}.json`); } catch (e) { setError(e.message); } }}>导出会话</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setDeleting(active)}>删除会话</Button>
                </div>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="全选会话标签页" checked={active.tabs.length > 0 && selection.size === active.tabs.length} disabled={busy} onChange={(e) => { setSelection(new Set(e.target.checked ? active.tabs.map((tab) => tab.url) : [])); setPreview(null); }} />全选标签页（{selection.size} / {active.tabs.length}）</label>
              <div className="max-h-[30vh] space-y-2 overflow-y-auto rounded-xl border p-3">
                {active.tabs.map((tab) => <label key={tab.url} className="flex min-w-0 items-start gap-2 border-b py-2 text-sm last:border-0"><input type="checkbox" aria-label={`会话标签 ${tab.title}`} checked={selection.has(tab.url)} disabled={busy} onChange={(e) => { setSelection((previous) => { const next = new Set(previous); if (e.target.checked) next.add(tab.url); else next.delete(tab.url); return next; }); setPreview(null); }} />
                  <span className="min-w-0 break-all"><span className="block">{tab.title}{tab.pinned ? ' · 已固定' : ''}{tab.group ? ` · ${tab.group.title}` : ''}</span><span className="block text-xs text-muted-foreground">{tab.url}</span></span>
                </label>)}
              </div>
              {draft ? <Button type="button" disabled={!selection.size || !name.trim() || busy} onClick={save}>保存选中标签页为会话</Button> : <>
                <label className="block text-sm">恢复目标<select aria-label="会话恢复目标" className="mt-1 block w-full rounded-xl border bg-background p-2" value={target} disabled={busy} onChange={(e) => { setTarget(e.target.value); setPreview(null); }}><option value="current">当前窗口（只新增标签页）</option><option value="new">新建普通窗口</option></select></label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={skipOpen} disabled={busy} onChange={(e) => { setSkipOpen(e.target.checked); setPreview(null); }} />跳过当前窗口已经打开的网址</label>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={group} disabled={busy} onChange={(e) => { setGroup(e.target.checked); setPreview(null); }} />恢复分组（固定标签页保持固定，不加入分组）</label>
                <Button type="button" variant="outline" disabled={busy || !selection.size || !extensionAvailable()} onClick={createPreview}>生成恢复预览</Button>
                {preview && <div className="space-y-2 rounded-xl border p-3 text-sm" role="region" aria-label="会话恢复预览">
                  <p>最多新增 {preview.plan.open.length} 个标签页，跳过当前已打开的 {preview.plan.skipped.length} 个。不会关闭、导航或重排现有页面。</p>
                  <details><summary className="cursor-pointer">查看将打开的网址</summary>{preview.plan.open.map((tab) => <p key={tab.url} className="break-all py-1 text-xs">{tab.title} · {tab.url}</p>)}</details>
                  <Button type="button" disabled={busy || !preview.plan.open.length} onClick={confirmRestore}>确认恢复 {preview.plan.open.length} 个标签页</Button>
                </div>}
              </>}
            </>}
            {busy && <p role="status" className="text-sm">正在处理… 关闭面板会停止后续打开，已打开的页面保留。</p>}
            {result && <div role="status" className="space-y-1 rounded-xl border p-3 text-sm"><p>已打开 {result.opened.length} 页，执行时另跳过 {result.skipped} 页，失败 {result.failed.length} 页{result.cancelled ? '；已停止后续恢复' : ''}。</p>
              {result.failed.map((item) => <p key={item.url} className="break-all text-xs">{item.url}：{item.message}</p>)}
              {result.groupErrors.map((message, i) => <p key={i} className="text-xs">分组/固定提示：{message}</p>)}
              {!!result.failed.length && <p className="text-xs">已只选中失败页面；重新生成预览可重试，不会重复打开本次成功的页面。</p>}
            </div>}
          </main>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={(next) => !next && setDeleting(null)}><DialogContent className="max-w-md"><DialogTitle>删除这个保存的会话？</DialogTitle><DialogDescription>仅删除本地会话记录，不关闭任何标签页。可先导出会话。</DialogDescription>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button type="button" variant="destructive" onClick={() => { try { deleteSession(deleting.id); setDeleting(null); } catch (e) { toast.error(e.message); } }}>确认删除会话</Button></div>
    </DialogContent></Dialog>
  </>;
};
export default SessionManager;
