import React, { useEffect, useMemo, useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import SiteIcon from '@/components/SiteIcon';
import { getActiveWorkspace, loadAdvancedState } from './storage';

const WorkspaceHomeFolders = () => {
  const [state, setState] = useState(() => loadAdvancedState());
  const [selectedFolderId, setSelectedFolderId] = useState('');

  useEffect(() => {
    const refresh = (event) => setState(event.detail || loadAdvancedState());
    window.addEventListener('navinocode:advanced-state', refresh);
    window.addEventListener('navinocode:snapshot-applied', refresh);
    return () => {
      window.removeEventListener('navinocode:advanced-state', refresh);
      window.removeEventListener('navinocode:snapshot-applied', refresh);
    };
  }, []);

  const activeWorkspace = useMemo(() => getActiveWorkspace(state), [state]);
  const folders = activeWorkspace?.folders || [];
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) || null;
  const folderApps = selectedFolder
    ? (activeWorkspace?.apps || []).filter((app) => selectedFolder.appIds.includes(String(app.id)))
    : [];

  if (folders.length === 0) return null;

  const openApp = (url) => {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) return;
      window.open(parsed.href, '_blank', 'noopener,noreferrer');
    } catch {}
  };

  return (
    <>
      <div className="fixed left-6 top-20 z-10 flex max-w-[calc(100vw-3rem)] gap-2 overflow-x-auto pb-1">
        {folders.map((folder) => {
          const appCount = folder.appIds.filter((appId) =>
            (activeWorkspace?.apps || []).some((app) => String(app.id) === String(appId))
          ).length;

          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelectedFolderId(folder.id)}
              className="flex min-w-[112px] items-center gap-2 rounded-2xl border border-white/40 bg-white/65 px-3 py-2 text-left shadow-sm backdrop-blur-md transition-transform hover:-translate-y-0.5 hover:bg-white/85 dark:border-white/10 dark:bg-gray-950/55 dark:hover:bg-gray-900/75"
              title={`打开文件夹：${folder.name}`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
                <Folder className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-800 dark:text-gray-100">
                  {folder.name}
                </span>
                <span className="block text-xs text-gray-500">{appCount} 个网站</span>
              </span>
            </button>
          );
        })}
      </div>

      <Dialog open={Boolean(selectedFolder)} onOpenChange={(open) => !open && setSelectedFolderId('')}>
        <DialogContent className="max-w-xl rounded-3xl">
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5 text-amber-500" />
            {selectedFolder?.name || '应用文件夹'}
          </DialogTitle>

          {folderApps.length === 0 ? (
            <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-gray-500">
              这个文件夹还没有网站，可在工作空间管理中添加。
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {folderApps.map((app) => (
                <button
                  key={app.id}
                  type="button"
                  onClick={() => openApp(app.url)}
                  className="flex min-w-0 flex-col items-center gap-2 rounded-2xl p-3 text-center transition-colors hover:bg-gray-100/80 dark:hover:bg-gray-800/70"
                  title={app.url}
                >
                  <SiteIcon app={app} size={48} />
                  <span className="w-full truncate text-xs text-gray-700 dark:text-gray-200">
                    {app.name || app.url}
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default WorkspaceHomeFolders;
