import { normalizeState } from './workspaceModel.js';
export const formatBytes = (bytes) => Number.isFinite(bytes) ? bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB` : '未测量';
export const downloadText = (text, filename, type = 'application/json') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export const downloadJSON = (value, filename) => downloadText(JSON.stringify(value, null, 2), filename);
export const snapshotFromState = (input) => {
  const state = normalizeState(input);
  const active = state.workspaces.find((ws) => ws.id === state.activeWorkspaceId) || state.workspaces[0];
  return { ...active.settings, apps: active.apps.filter((app) => !app.folderId), advancedState: state };
};
