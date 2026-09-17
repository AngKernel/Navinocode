import React, { useEffect, useState } from 'react';
import { Command, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import CommandCenter from './CommandCenter';
import WorkspaceManager from './WorkspaceManager';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import WorkspaceHomeFolders from './WorkspaceHomeFolders';
import { initializeNativeSync } from './nativeSync';

const AdvancedFeatures = () => {
  const [commandOpen, setCommandOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [initialFolderId, setInitialFolderId] = useState('');

  useEffect(() => {
    const openLibrary = (event) => { setInitialFolderId(event.detail?.folderId || ''); setWorkspaceOpen(true); };
    window.addEventListener('navinocode:open-library', openLibrary);
    return () => window.removeEventListener('navinocode:open-library', openLibrary);
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => initializeNativeSync(), []);

  useEffect(() => {
    const onConflict = (event) => toast(event.detail?.message || '同步冲突已自动合并');
    const onNativeApplied = () => toast('浏览器账户配置已更新并立即生效');
    window.addEventListener('navinocode:sync-conflict', onConflict);
    window.addEventListener('navinocode:native-sync-applied', onNativeApplied);
    return () => {
      window.removeEventListener('navinocode:sync-conflict', onConflict);
      window.removeEventListener('navinocode:native-sync-applied', onNativeApplied);
    };
  }, []);

  return (
    <>
      <div className="fixed left-4 top-6 sm:left-6 z-20 flex max-w-[calc(100vw-3rem)] items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="打开命令中心"
          title="命令中心（Ctrl/⌘ + K）"
          onClick={() => setCommandOpen(true)}
          className="h-10 w-10 shrink-0 rounded-full opacity-80 backdrop-blur-md transition-opacity hover:opacity-100"
        >
          <Command className="h-5 w-5" />
        </Button>

        <WorkspaceSwitcher />

        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="整理网站"
          title="整理网站：工作区与文件夹"
          onClick={() => { setInitialFolderId(''); setWorkspaceOpen(true); }}
          className="h-10 w-10 shrink-0 rounded-full opacity-80 backdrop-blur-md transition-opacity hover:opacity-100"
        >
          <LayoutGrid className="h-5 w-5" />
        </Button>
      </div>

      <WorkspaceHomeFolders />
      <CommandCenter open={commandOpen} onOpenChange={setCommandOpen} />
      <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} initialFolderId={initialFolderId} />
    </>
  );
};

export default AdvancedFeatures;
