import React, { useEffect, useMemo, useState } from 'react';
import { Folder, FolderPlus, LayoutGrid, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  addFolder,
  addWorkspace,
  deleteFolder,
  deleteWorkspace,
  getActiveWorkspace,
  loadAdvancedState,
  renameFolder,
  renameWorkspace,
  switchWorkspace,
  toggleAppInFolder,
} from './storage';

const WorkspaceManager = ({ open, onOpenChange, footer = null }) => {
  const [state, setState] = useState(() => loadAdvancedState());
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [folderNames, setFolderNames] = useState({});

  const activeWorkspace = useMemo(() => getActiveWorkspace(state), [state]);

  useEffect(() => {
    if (!open) return;
    const next = loadAdvancedState();
    setState(next);
  }, [open]);

  useEffect(() => {
    setWorkspaceName(activeWorkspace?.name || '');
    setFolderNames(Object.fromEntries((activeWorkspace?.folders || []).map((folder) => [folder.id, folder.name])));
  }, [activeWorkspace]);

  useEffect(() => {
    const refresh = (event) => setState(event.detail || loadAdvancedState());
    window.addEventListener('navinocode:advanced-state', refresh);
    return () => window.removeEventListener('navinocode:advanced-state', refresh);
  }, []);

  const commit = (next) => {
    setState(next);
    return next;
  };

  const changeWorkspace = (workspaceId) => {
    if (workspaceId === state.activeWorkspaceId) return;
    commit(switchWorkspace(state, workspaceId));
    toast('工作空间已切换');
    setTimeout(() => window.location.reload(), 180);
  };

  const createWorkspace = () => {
    const name = newWorkspaceName.trim();
    if (!name) return;
    commit(addWorkspace(state, name));
    setNewWorkspaceName('');
    toast('工作空间已创建');
    setTimeout(() => window.location.reload(), 180);
  };

  const saveWorkspaceName = () => {
    if (!activeWorkspace) return;
    commit(renameWorkspace(state, activeWorkspace.id, workspaceName));
    toast('名称已保存');
  };

  const removeWorkspace = (workspaceId) => {
    if (state.workspaces.length <= 1) return toast('至少保留一个工作空间');
    commit(deleteWorkspace(state, workspaceId));
    toast('工作空间已删除');
    setTimeout(() => window.location.reload(), 180);
  };

  const createFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    commit(addFolder(state, name));
    setNewFolderName('');
  };

  const saveFolderName = (folderId) => {
    commit(renameFolder(state, folderId, folderNames[folderId]));
  };

  const openApp = (url) => {
    try {
      const target = new URL(url);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('unsupported');
      window.open(target.href, '_blank', 'noopener,noreferrer');
    } catch {
      toast('应用网址无效');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-4xl overflow-hidden rounded-3xl p-0">
        <DialogTitle className="sr-only">工作空间和文件夹</DialogTitle>
        <div className="grid min-h-[620px] grid-cols-1 md:grid-cols-[220px_1fr]">
          <aside className="border-b bg-gray-50/80 p-4 dark:bg-gray-950/60 md:border-b-0 md:border-r">
            <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <LayoutGrid className="h-4 w-4" />工作空间
            </div>
            <div className="space-y-1">
              {state.workspaces.map((workspace) => (
                <div key={workspace.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => changeWorkspace(workspace.id)}
                    className={`min-w-0 flex-1 truncate rounded-xl px-3 py-2 text-left text-sm ${
                      workspace.id === state.activeWorkspaceId
                        ? 'bg-white font-medium shadow-sm dark:bg-gray-800'
                        : 'hover:bg-white/70 dark:hover:bg-gray-900'
                    }`}
                  >
                    {workspace.name}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100"
                    onClick={() => removeWorkspace(workspace.id)}
                    disabled={state.workspaces.length <= 1}
                    aria-label={`删除 ${workspace.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              <Input
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && createWorkspace()}
                placeholder="新工作空间"
                className="h-9 rounded-xl"
              />
              <Button type="button" variant="secondary" className="w-full rounded-xl" onClick={createWorkspace}>
                <Plus className="mr-2 h-4 w-4" />创建
              </Button>
            </div>
          </aside>

          <main className="overflow-y-auto p-5">
            <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="workspace-name">当前工作空间</Label>
                <Input
                  id="workspace-name"
                  value={workspaceName}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && saveWorkspaceName()}
                  className="mt-2 rounded-xl"
                />
              </div>
              <Button type="button" variant="outline" className="rounded-xl" onClick={saveWorkspaceName}>
                <Pencil className="mr-2 h-4 w-4" />保存名称
              </Button>
            </div>

            <section className="py-5">
              <div className="mb-3 flex items-center gap-2 font-semibold">
                <Folder className="h-4 w-4" />应用文件夹
              </div>
              <div className="mb-4 flex gap-2">
                <Input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && createFolder()}
                  placeholder="例如：开发、工作、AI"
                  className="rounded-xl"
                />
                <Button type="button" variant="secondary" className="rounded-xl" onClick={createFolder}>
                  <FolderPlus className="mr-2 h-4 w-4" />新建
                </Button>
              </div>

              {(activeWorkspace?.folders || []).length === 0 ? (
                <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-gray-500">
                  暂无文件夹。创建后可将当前工作空间的应用加入其中。
                </div>
              ) : (
                <div className="space-y-4">
                  {activeWorkspace.folders.map((folder) => (
                    <div key={folder.id} className="rounded-2xl border p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Input
                          value={folderNames[folder.id] ?? folder.name}
                          onChange={(event) => setFolderNames((names) => ({ ...names, [folder.id]: event.target.value }))}
                          onBlur={() => saveFolderName(folder.id)}
                          className="h-9 rounded-xl font-medium"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() => commit(deleteFolder(state, folder.id))}
                          aria-label={`删除文件夹 ${folder.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {(activeWorkspace.apps || []).map((app) => {
                          const selected = folder.appIds.includes(String(app.id));
                          return (
                            <div
                              key={app.id}
                              className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${selected ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 truncate text-left text-sm"
                                onClick={() => openApp(app.url)}
                                title={app.url}
                              >
                                {app.name || app.url}
                              </button>
                              <Button
                                type="button"
                                size="sm"
                                variant={selected ? 'secondary' : 'outline'}
                                className="h-7 rounded-lg px-2 text-xs"
                                onClick={() => commit(toggleAppInFolder(state, folder.id, app.id))}
                              >
                                {selected ? '已加入' : '加入'}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {footer ? <section className="border-t pt-5">{footer}</section> : null}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default WorkspaceManager;
