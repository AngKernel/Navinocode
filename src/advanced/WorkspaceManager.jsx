import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Folder, FolderPlus, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import SiteIcon from '@/components/SiteIcon';
import EditAppDialog from '@/components/EditAppDialog';
import { buildIconFields, normalizeAppUrl } from '@/lib/siteIcons';
import { useWorkspaceStore } from './useWorkspaceStore';
import { makeId } from './workspaceModel';
import { isComposingEvent } from './interactionUtils';
import { addFolder, addWorkspace, deleteFolder, deleteWorkspace, duplicateWorkspace, getActiveWorkspace, moveApps,
  renameFolder, renameWorkspace, setWorkspaceApps, switchWorkspace, withUndo } from './storage';

const selectClass = 'h-9 min-w-0 rounded-xl border bg-background px-2 text-sm';
const WorkspaceManager = ({ open, onOpenChange, initialFolderId = '' }) => {
  const state = useWorkspaceStore();
  const workspace = getActiveWorkspace(state);
  const [folderId, setFolderId] = useState('');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [folderName, setFolderName] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [editApp, setEditApp] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [undo, setUndo] = useState(null);
  const folder = workspace.folders.find((item) => item.id === folderId);
  const currentFolderId = folder?.id || null;
  const apps = useMemo(() => workspace.apps.filter((app) => app.folderId === currentFolderId
    && (!query.trim() || `${app.name} ${app.url}`.toLowerCase().includes(query.trim().toLowerCase()))), [workspace.apps, currentFolderId, query]);

  useEffect(() => { if (open) setFolderId(initialFolderId || ''); }, [open, initialFolderId]);
  useEffect(() => {
    setFolderId(''); setSelected(new Set()); setQuery(''); setEditApp(null); setName(''); setUrl('');
  }, [workspace.id]);
  useEffect(() => { setWorkspaceName(workspace.name); }, [workspace.id, workspace.name]);
  useEffect(() => { setFolderName(folder?.name || ''); setSelected(new Set()); }, [folder?.id, folder?.name]);
  useEffect(() => {
    setSelected((previous) => new Set([...previous].filter((id) => apps.some((app) => app.id === id))));
  }, [apps]);

  const perform = (operation) => {
    try { return operation(); }
    catch (error) { toast.error(error.message || '操作失败，原配置未改动'); return false; }
  };
  const deleteWithUndo = (operation, message) => perform(() => {
    const undoOperation = withUndo(operation);
    const undoOnce = () => perform(() => { undoOperation(); setUndo(null); toast('已撤销删除'); });
    setUndo(() => undoOnce);
    toast(message, { action: { label: '撤销', onClick: undoOnce } });
  });
  const removeApps = (ids) => deleteWithUndo(() => setWorkspaceApps(workspace.id,
    (items) => items.filter((app) => !ids.includes(app.id))), '网站已删除');
  const submit = (operation) => (event) => { event.preventDefault(); perform(operation); };
  const preventCompositionSubmit = (event) => {
    if (event.key === 'Enter' && isComposingEvent(event)) event.preventDefault();
  };
  const createApp = () => {
    const normalized = normalizeAppUrl(url);
    if (!normalized) throw new Error('请输入有效的 http(s) 网站地址');
    setWorkspaceApps(workspace.id, (items) => {
      if (items.some((app) => normalizeAppUrl(app.url) === normalized)) throw new Error('当前工作区已有该网址，可搜索后移动到目标文件夹');
      return [...items, { id: makeId('app'), name: name.trim() || new URL(normalized).hostname,
        url: normalized, folderId: currentFolderId, ...buildIconFields({ url: normalized, iconMode: 'auto' }) }];
    });
    setName(''); setUrl(''); toast('网站已添加');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[88vh] max-h-[820px] max-w-5xl flex-col gap-0 overflow-hidden rounded-3xl p-0" onKeyDown={preventCompositionSubmit}>
          <header className="shrink-0 border-b px-5 py-4 pr-12">
            <DialogTitle>整理网站</DialogTitle>
            <DialogDescription className="mt-1 text-xs">工作区切换使用场景；文件夹只整理当前场景内的网站。每个网站只有一个归属。</DialogDescription>
          </header>
          <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[240px_minmax(0,1fr)] md:grid-rows-1">
            <aside className="max-h-[32vh] min-h-0 overflow-y-auto border-b bg-muted/30 p-4 md:max-h-none md:border-b-0 md:border-r">
              <label className="block text-xs font-medium" htmlFor="library-workspace">工作区</label>
              <select id="library-workspace" aria-label="整理面板工作区" value={workspace.id} className={`${selectClass} mt-2 w-full`}
                onChange={(event) => perform(() => switchWorkspace(state, event.target.value))}>
                {state.workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name}</option>)}
              </select>
              <details className="mt-3">
                <summary className="cursor-pointer rounded-lg py-1 text-xs text-muted-foreground">管理工作区（新建、复制、改名）</summary>
              <form onSubmit={submit(() => renameWorkspace(state, workspace.id, workspaceName))} className="mt-2 flex gap-1">
                <Input aria-label="工作区名称" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} className="h-9 min-w-0 rounded-xl" />
                <Button type="submit" size="icon" variant="ghost" aria-label="保存工作区名称"><Pencil className="h-4 w-4" /></Button>
              </form>
              <div className="mt-1 flex gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => perform(() => duplicateWorkspace(state, workspace.id))}><Copy className="mr-1 h-3.5 w-3.5" />复制场景</Button>
                <Button type="button" size="sm" variant="ghost" disabled={state.workspaces.length <= 1} onClick={() => setConfirm({
                  title: `删除工作区“${workspace.name}”？`, description: `将删除其中的 ${workspace.apps.length} 个网站、文件夹及场景设置。删除后可撤销。`,
                  run: () => deleteWithUndo(() => deleteWorkspace(state, workspace.id), '工作区已删除'),
                })}>删除</Button>
              </div>
              <form onSubmit={submit(() => {
                if (!newWorkspaceName.trim()) return;
                addWorkspace(state, newWorkspaceName); setNewWorkspaceName('');
              })} className="mt-3 flex gap-1">
                <Input aria-label="新工作区名称" placeholder="新建空白工作区" value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} className="h-9 min-w-0 rounded-xl" />
                <Button type="submit" size="icon" variant="secondary" aria-label="创建空白工作区" disabled={!newWorkspaceName.trim()}><Plus className="h-4 w-4" /></Button>
              </form>
              </details>
              <div className="my-4 border-t" />
              <nav aria-label="当前工作区文件夹" className="space-y-1">
                <button type="button" aria-current={!folder ? 'page' : undefined} onClick={() => setFolderId('')}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm ${!folder ? 'bg-background font-medium shadow-sm' : 'hover:bg-muted'}`}>
                  未分组 <span className="text-xs text-muted-foreground">{workspace.apps.filter((app) => !app.folderId).length}</span>
                </button>
                {workspace.folders.map((item) => <button key={item.id} type="button" aria-current={item.id === folderId ? 'page' : undefined}
                  onClick={() => setFolderId(item.id)} className={`flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ${item.id === folderId ? 'bg-background font-medium shadow-sm' : 'hover:bg-muted'}`}>
                  <Folder className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{workspace.apps.filter((app) => app.folderId === item.id).length}</span>
                </button>)}
              </nav>
              <form onSubmit={submit(() => { if (newFolderName.trim()) { addFolder(state, newFolderName); setNewFolderName(''); } })} className="mt-3 flex gap-1">
                <Input aria-label="新文件夹名称" placeholder="新建文件夹" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} className="h-9 min-w-0 rounded-xl" />
                <Button type="submit" size="icon" variant="secondary" aria-label="创建文件夹" disabled={!newFolderName.trim()}><FolderPlus className="h-4 w-4" /></Button>
              </form>
            </aside>
            <main className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                {folder ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={submit(() => renameFolder(state, folder.id, folderName))}>
                  <Input aria-label="文件夹名称" value={folderName} onChange={(event) => setFolderName(event.target.value)} className="h-9 max-w-60 rounded-xl font-medium" />
                  <Button type="submit" variant="ghost" size="icon" aria-label="保存文件夹名称"><Pencil className="h-4 w-4" /></Button>
                </form> : <h2 className="font-semibold">未分组</h2>}
                {folder && <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm({
                  title: `解散文件夹“${folder.name}”？`, description: '不会删除网站，里面的网站将移回“未分组”。',
                  run: () => { deleteWithUndo(() => deleteFolder(state, folder.id), '文件夹已解散，网站移回未分组'); setFolderId(''); },
                })}>解散文件夹</Button>}
              </div>
              <form onSubmit={submit(createApp)} className="mb-4 grid gap-2 rounded-2xl border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <Input aria-label="网站名称" placeholder="名称（可选）" value={name} onChange={(event) => setName(event.target.value)} className="min-w-0 rounded-xl" />
                <Input aria-label="网站地址" placeholder="输入网址，例如 example.com" value={url} onChange={(event) => setUrl(event.target.value)} className="min-w-0 rounded-xl" />
                <Button type="submit" disabled={!url.trim()} className="rounded-xl"><Plus className="mr-1 h-4 w-4" />添加网站</Button>
              </form>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input aria-label="筛选当前目录" placeholder="筛选当前目录；Ctrl/⌘+K 可搜索所有工作区" value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 min-w-[150px] flex-1 rounded-xl" />
                <select aria-label="批量移动网站" className={selectClass} value="" disabled={!selected.size} onChange={(event) => perform(() => {
                  moveApps(workspace.id, [...selected], event.target.value === '__root__' ? null : event.target.value); setSelected(new Set());
                })}>
                  <option value="" disabled>移动选中（{selected.size}）</option><option value="__root__">未分组</option>
                  {workspace.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              {!apps.length ? <div className="rounded-2xl border border-dashed py-12 text-center text-sm text-muted-foreground">{query ? '没有匹配的网站' : '这里还没有网站。添加一个，或从其他目录移入。'}</div> :
                <div className="divide-y rounded-2xl border px-3">
                  {apps.map((app) => <div key={app.id} data-app-id={app.id} className="flex min-w-0 flex-wrap items-center gap-2 py-3 sm:flex-nowrap">
                    <input type="checkbox" aria-label={`选择 ${app.name}`} checked={selected.has(app.id)} onChange={(event) => setSelected((previous) => {
                      const next = new Set(previous); if (event.target.checked) next.add(app.id); else next.delete(app.id); return next;
                    })} className="h-4 w-4 shrink-0" />
                    <SiteIcon app={app} size={32} />
                    <a href={normalizeAppUrl(app.url) || undefined} target="_blank" rel="noopener noreferrer" className="min-w-[100px] flex-1 overflow-hidden" title={app.url}>
                      <span className="block truncate text-sm font-medium">{app.name}</span><span className="block truncate text-xs text-muted-foreground">{app.url}</span>
                    </a>
                    <select aria-label={`移动 ${app.name}`} value={app.folderId || '__root__'} className={`${selectClass} max-w-36`} onChange={(event) => perform(() => moveApps(workspace.id, [app.id], event.target.value === '__root__' ? null : event.target.value))}>
                      <option value="__root__">未分组</option>{workspace.folders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <Button type="button" variant="ghost" size="icon" aria-label={`编辑 ${app.name}`} onClick={() => setEditApp(app)}><Pencil className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`删除 ${app.name}`} onClick={() => removeApps([app.id])}><Trash2 className="h-4 w-4" /></Button>
                  </div>)}
                </div>}
              {undo && <Button type="button" variant="outline" className="mt-4 rounded-xl" onClick={undo}><Undo2 className="mr-2 h-4 w-4" />撤销上一次删除</Button>}
              <p className="mt-4 text-xs text-muted-foreground">同步与备份统一放在“设置 → 数据”，不随工作区切换。</p>
            </main>
          </div>
        </DialogContent>
      </Dialog>
      <EditAppDialog isOpen={Boolean(editApp)} setIsOpen={(next) => !next && setEditApp(null)} app={editApp}
        setApps={(value) => perform(() => setWorkspaceApps(workspace.id, value))} />
      <AlertDialog open={Boolean(confirm)} onOpenChange={(next) => !next && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{confirm?.title}</AlertDialogTitle><AlertDialogDescription>{confirm?.description}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { confirm?.run(); setConfirm(null); }}>确认</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
export default WorkspaceManager;
