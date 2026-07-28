import React, { useEffect, useState } from 'react';
import { Command } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CommandCenter from './CommandCenter';

const AdvancedFeatures = () => {
  const [commandOpen, setCommandOpen] = useState(false);

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
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="打开命令中心"
        title="命令中心（Ctrl/⌘ + K）"
        onClick={() => setCommandOpen(true)}
        className="fixed left-6 top-6 z-20 h-10 w-10 rounded-full opacity-70 transition-opacity hover:opacity-100"
      >
        <Command className="h-5 w-5" />
      </Button>
      <CommandCenter open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
};

export default AdvancedFeatures;
