import React, { useEffect, useState } from 'react';
import { Command, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CommandCenter from './CommandCenter';
import WorkspaceManager from './WorkspaceManager';

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
          title="工作空间与文件夹"
          onClick={() => setWorkspaceOpen(true)}
          className="h-10 w-10 rounded-full opacity-70 transition-opacity hover:opacity-100"
        >
          <LayoutGrid className="h-5 w-5" />
        </Button>
      </div>
      <CommandCenter open={commandOpen} onOpenChange={setCommandOpen} />
      <WorkspaceManager open={workspaceOpen} onOpenChange={setWorkspaceOpen} />
    </>
  );
};

export default AdvancedFeatures;
