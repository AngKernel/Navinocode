import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { getActiveWorkspace, getRootApps, loadAdvancedState, setWorkspaceApps, setWorkspaceSetting, subscribeWorkspaceStore } from './storage.js';

export const useWorkspaceStore = () => useSyncExternalStore(subscribeWorkspaceStore, loadAdvancedState);
export const useWorkspaceSetting = (key) => {
  const state = useWorkspaceStore();
  const workspace = getActiveWorkspace(state);
  // A delayed file/image callback remains scoped to its originating workspace.
  const set = useCallback((value) => {
    try { return setWorkspaceSetting(workspace.id, key, value); }
    catch (error) { toast.error(error.message || '保存失败，原配置未改动'); return false; }
  }, [workspace.id, key]);
  return [workspace.settings[key], set];
};
export const useRootApps = () => {
  const workspace = getActiveWorkspace(useWorkspaceStore());
  const apps = useMemo(() => getRootApps(workspace), [workspace.apps]);
  const set = useCallback((value) => {
    try { return setWorkspaceApps(workspace.id, value, { rootOnly: true }); }
    catch (error) { toast.error(error.message || '保存失败，原配置未改动'); return false; }
  }, [workspace.id]);
  return [apps, set];
};
