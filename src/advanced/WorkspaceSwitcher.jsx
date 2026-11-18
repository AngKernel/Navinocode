import React from 'react';
import { Layers3 } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspaceStore } from './useWorkspaceStore';
import { switchWorkspace } from './storage';

const WorkspaceSwitcher = () => {
  const state = useWorkspaceStore();
  if (state.workspaces.length <= 1) return null;
  return (
    <label className="flex h-10 min-w-0 items-center gap-2 rounded-full border bg-background/80 px-3 text-sm backdrop-blur-md" title="切换工作区">
      <Layers3 className="h-4 w-4 shrink-0" />
      <select value={state.activeWorkspaceId} aria-label="切换工作区" className="max-w-[140px] min-w-0 bg-transparent outline-none focus-visible:ring-2"
        onChange={(event) => { try { switchWorkspace(state, event.target.value); } catch (error) { toast.error(error.message); } }}>
        {state.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </label>
  );
};
export default WorkspaceSwitcher;
