import React, { useEffect, useState } from 'react';
import { Command, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import CommandCenter from './CommandCenter';
import WorkspaceManager from './WorkspaceManager';
import SyncControls from './SyncControls';
import { initializeNativeSync } from './nativeSync';

const AdvancedFeatures = () => {
  const [commandOpen, setCommandOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

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
    const onNativeApplied = () => toast('浏览器账户有新配置，重新打开新标签页后完全生效');
    window.addEventListener('navinocode:sync-conflict', onConflict);
    window.addEventListener('navinocode:native-sync-applied', onNativeApplied);
    return () => {
      window.removeEventListener('navinocode:sync-conflict', onConflict);
      window.removeEventListener('navinocode:native-sync-applied', onNativeApplied);
    };
  }, []);

  return (
    <>
      <div className="fixed left-6 top-6 z-20 flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="打开命令中心"
          title="命令中心（Ctrl/⌘ + K）"
          onClick={() => setCommandOpen(true)}
          className="h-10 w-10 rounded-full opacity-70 transition-opacity hover:opacity-100"
        >
          <Command className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="管理工作空间"
          title="工作空间、文件夹与同步"
          onClick={() => setWorkspaceOpen(true)}
          className="h-10 w-10 rounded-full opacity-70 transition-opacity hover:opacity-100"
        >
          <LayoutGrid className="h-5 w-5" />
        </Button>
      </div>
      <CommandCenter open={commandOpen} onOpenChange={setCommandOpen} />
      <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} footer={<SyncControls />} />
    </>
  );
};

export default AdvancedFeatures;
