import React, { useEffect, useState } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import SiteIcon from '@/components/SiteIcon';
import { normalizeAppUrl } from '@/lib/siteIcons';
import { useWorkspaceStore } from './useWorkspaceStore';
import { getActiveWorkspace } from './storage';

const WorkspaceHomeFolders = () => {
  const workspace = getActiveWorkspace(useWorkspaceStore());
  const [selectedId, setSelectedId] = useState('');
  useEffect(() => setSelectedId(''), [workspace.id]);
  const selected = workspace.folders.find((folder) => folder.id === selectedId);
  if (!workspace.folders.length) return null;
  const apps = workspace.apps.filter((app) => app.folderId === selectedId);
  return <>
    <nav aria-label="工作区文件夹" className="fixed left-4 top-20 z-10 flex max-w-[calc(100vw-2rem)] gap-2 overflow-x-auto pb-1 sm:left-6">
      {workspace.folders.map((folder) => <button key={folder.id} type="button" onClick={() => setSelectedId(folder.id)}
        className="flex max-w-56 shrink-0 items-center gap-2 rounded-2xl border bg-background/75 px-3 py-2 text-left shadow-sm backdrop-blur-md hover:bg-background" title={`打开文件夹：${folder.name}`}>
        <Folder className="h-5 w-5 shrink-0" /><span className="truncate text-sm font-medium">{folder.name}</span>
        <span className="text-xs text-muted-foreground">{workspace.apps.filter((app) => app.folderId === folder.id).length}</span>
      </button>)}
    </nav>
    <Dialog open={Boolean(selected)} onOpenChange={(next) => !next && setSelectedId('')}>
      <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto rounded-3xl">
        <DialogTitle className="flex items-center gap-2"><FolderOpen className="h-5 w-5" />{selected?.name}</DialogTitle>
        <DialogDescription>{workspace.name} · {apps.length} 个网站</DialogDescription>
        {!apps.length ? <p className="py-8 text-center text-sm text-muted-foreground">文件夹为空，可在“整理网站”中添加或移入。</p> :
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">{apps.map((app) => <a key={app.id} href={normalizeAppUrl(app.url) || undefined} target="_blank" rel="noopener noreferrer"
            className="flex min-w-0 flex-col items-center gap-2 rounded-2xl p-3 text-center hover:bg-muted" title={app.url}>
            <SiteIcon app={app} size={48} /><span className="w-full truncate text-xs">{app.name}</span>
          </a>)}</div>}
        <Button variant="outline" onClick={() => { const id = selectedId; setSelectedId(''); window.dispatchEvent(new CustomEvent('navinocode:open-library', { detail: { folderId: id } })); }}>整理此文件夹</Button>
      </DialogContent>
    </Dialog>
  </>;
};
export default WorkspaceHomeFolders;
