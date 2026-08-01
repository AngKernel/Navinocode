import React, { useEffect, useMemo, useState } from 'react';
import { Layers3 } from 'lucide-react';
import { toast } from 'sonner';
import { getActiveWorkspace, loadAdvancedState, switchWorkspace } from './storage';

const WorkspaceSwitcher = () => {
  const [state, setState] = useState(() => loadAdvancedState());

  useEffect(() => {
    const refresh = (event) => setState(event.detail || loadAdvancedState());
    window.addEventListener('navinocode:advanced-state', refresh);
    return () => window.removeEventListener('navinocode:advanced-state', refresh);
  }, []);

  const activeWorkspace = useMemo(() => getActiveWorkspace(state), [state]);

  if (state.workspaces.length <= 1) return null;

  const handleChange = (event) => {
    const workspaceId = event.target.value;
    if (!workspaceId || workspaceId === state.activeWorkspaceId) return;
    switchWorkspace(state, workspaceId);
    toast('工作空间已切换');
    window.setTimeout(() => window.location.reload(), 120);
  };

  return (
    <label
      className="flex h-10 items-center gap-2 rounded-full border border-gray-200/70 bg-white/70 px-3 text-sm shadow-sm backdrop-blur-md transition-colors hover:bg-white/90 dark:border-gray-700/70 dark:bg-gray-950/60 dark:hover:bg-gray-900/80"
      title="切换工作空间"
    >
      <Layers3 className="h-4 w-4 shrink-0 text-gray-500" />
      <select
        value={activeWorkspace?.id || ''}
        onChange={handleChange}
        aria-label="切换工作空间"
        className="max-w-[150px] cursor-pointer appearance-none truncate bg-transparent pr-2 font-medium text-gray-700 outline-none dark:text-gray-200"
      >
        {state.workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
};

export default WorkspaceSwitcher;
