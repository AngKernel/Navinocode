// Pure schema/migration helpers. A workspace is a scene; a folder is a single
// location within that scene. There is no second folder membership array.
export const SCHEMA_VERSION = 5;
export const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export const array = (value) => Array.isArray(value) ? value : [];
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const makeId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const entityKey = (workspaceId, id) => `${workspaceId}:${id}`;
export const parseJSON = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
export const number = (value, fallback, min, max) => {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
export const DEFAULT_SETTINGS = {
  todos: [], componentSettings: { pomodoro: false, heatmap: false, todo: false },
  searchEngine: 'bing', onlineSuggestionsEnabled: false, backgroundImage: '',
  backgroundBrightness: 100, backgroundBlur: 0, backgroundOverlay: 24,
  themeMode: 'system', bottomCount: 8, widgetPositions: '', widgetPins: '', pomodoroMinutes: 25,
};
const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
export const normalizeSettings = (input, fallback = DEFAULT_SETTINGS) => {
  const source = { ...DEFAULT_SETTINGS, ...fallback, ...(isRecord(input) ? input : {}) };
  const components = source.componentSettings || {};
  return {
    todos: array(source.todos).filter((item) => isRecord(item) && typeof item.text === 'string').map((item, i) => ({
      ...item, id: String(item.id ?? `legacy-todo-${i}`), completed: item.completed === true,
    })),
    componentSettings: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.componentSettings).map((key) => [key, components[key] === true])),
    searchEngine: ['bing', 'google', 'baidu', 'duckduckgo'].includes(source.searchEngine) ? source.searchEngine : 'bing',
    onlineSuggestionsEnabled: source.onlineSuggestionsEnabled === true,
    backgroundImage: text(source.backgroundImage),
    backgroundBrightness: number(source.backgroundBrightness, 100, 0, 200),
    backgroundBlur: number(source.backgroundBlur, 0, 0, 20),
    backgroundOverlay: number(source.backgroundOverlay, 24, 0, 60),
    themeMode: ['system', 'light', 'dark'].includes(source.themeMode) ? source.themeMode : 'system',
    bottomCount: Math.floor(number(source.bottomCount, 8, 0, 8)),
    widgetPositions: text(source.widgetPositions), widgetPins: text(source.widgetPins),
    pomodoroMinutes: Math.floor(number(source.pomodoroMinutes, 25, 1, 180)),
  };
};
export const normalizeTombstones = (input) => Object.fromEntries(['workspaces', 'folders', 'apps', 'todos'].map((key) => [
  key, isRecord(input?.[key]) ? { ...input[key] } : {},
]));
export const normalizeWorkspace = (input, index = 0) => {
  const source = isRecord(input) ? input : {};
  const id = String(source.id || `legacy-workspace-${index}`);
  const rawFolders = array(source.folders).filter(isRecord);
  const folders = rawFolders.map((folder, i) => ({
    id: String(folder.id || `legacy-folder-${i}`), name: text(folder.name, '文件夹').trim() || '文件夹',
    updatedAt: folder.updatedAt || source.updatedAt || '',
  }));
  const validFolders = new Set(folders.map((folder) => folder.id));
  const firstFolder = new Map();
  rawFolders.forEach((folder, i) => array(folder.appIds).forEach((appId) => {
    if (!firstFolder.has(String(appId))) firstFolder.set(String(appId), folders[i].id);
  }));
  const seen = new Set();
  const apps = array(source.apps).filter((app) => isRecord(app) && typeof app.url === 'string').map((app, i) => {
    let appId = String(app.id ?? `legacy-app-${i}`);
    // Repair duplicate legacy IDs deterministically, without deleting a website.
    if (seen.has(appId)) appId = `${appId}-duplicate-${i}`;
    seen.add(appId);
    const requested = Object.prototype.hasOwnProperty.call(app, 'folderId') ? app.folderId : firstFolder.get(appId);
    return { ...app, id: appId, name: text(app.name, app.url),
      folderId: requested != null && validFolders.has(String(requested)) ? String(requested) : null,
      updatedAt: app.updatedAt || source.updatedAt || '',
    };
  });
  return { ...source, id, name: text(source.name, '工作区').trim() || '工作区', apps, folders,
    settings: normalizeSettings(source.settings), settingVersions: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, source.settingVersions?.[key] || source.updatedAt || source.createdAt || ''])),
    nameUpdatedAt: source.nameUpdatedAt || source.updatedAt || '',
    orderUpdatedAt: source.orderUpdatedAt || source.updatedAt || '',
    createdAt: source.createdAt || source.updatedAt || '', updatedAt: source.updatedAt || '',
  };
};
export const normalizeState = (input) => {
  if (!isRecord(input) || !array(input.workspaces).length) throw new Error('工作区配置无效');
  if (Number(input.schemaVersion) > SCHEMA_VERSION) throw new Error('配置来自更新版本，请先升级 Navinocode');
  const tombstones = normalizeTombstones(input.tombstones);
  const workspaces = input.workspaces.map(normalizeWorkspace).filter((ws) => !tombstones.workspaces[ws.id]).map((ws) => {
    const folders = ws.folders.filter((folder) => !tombstones.folders[entityKey(ws.id, folder.id)]);
    const folderIds = new Set(folders.map((folder) => folder.id));
    return { ...ws, folders,
      apps: ws.apps.filter((app) => !tombstones.apps[entityKey(ws.id, app.id)]).map((app) => ({
        ...app, folderId: folderIds.has(app.folderId) ? app.folderId : null,
      })),
      settings: { ...ws.settings, todos: ws.settings.todos.filter((todo) => !tombstones.todos[entityKey(ws.id, todo.id)]) },
    };
  });
  if (!workspaces.length) throw new Error('同步删除了所有工作区，请先检查两端配置');
  const activeWorkspaceId = workspaces.some((ws) => ws.id === String(input.activeWorkspaceId)) ? String(input.activeWorkspaceId) : workspaces[0].id;
  return { ...input, schemaVersion: SCHEMA_VERSION, activeWorkspaceId, workspaces, tombstones };
};
export const getActiveWorkspace = (state) => state.workspaces.find((ws) => ws.id === state.activeWorkspaceId) || state.workspaces[0];
export const getRootApps = (workspace) => workspace.apps.filter((app) => !app.folderId);
export const validateFullSnapshot = (snapshot) => {
  const invalid = () => { throw new Error('配置格式无效，未覆盖本地数据'); };
  if (!isRecord(snapshot)) invalid();
  const validateApps = (apps) => {
    if (!Array.isArray(apps) || apps.some((app) => !isRecord(app) || typeof app.url !== 'string')) invalid();
  };
  const validateSettings = (settings) => {
    if (!isRecord(settings)) invalid();
    if (settings.todos !== undefined && (!Array.isArray(settings.todos) || settings.todos.some((todo) => !isRecord(todo) || typeof todo.text !== 'string'))) invalid();
    if (settings.componentSettings !== undefined && !isRecord(settings.componentSettings)) invalid();
  };
  validateSettings(snapshot);
  if (snapshot.apps !== undefined) validateApps(snapshot.apps);
  if (snapshot.advancedState !== undefined) {
    const state = snapshot.advancedState;
    if (!isRecord(state) || !Array.isArray(state.workspaces) || !state.workspaces.length) invalid();
    if (Number(state.schemaVersion) > SCHEMA_VERSION) throw new Error('配置来自更新版本，请先升级 Navinocode');
    const ids = new Set();
    for (const ws of state.workspaces) {
      if (!isRecord(ws) || typeof ws.id !== 'string' || !ws.id || ids.has(ws.id)) invalid();
      ids.add(ws.id);
      if (ws.apps !== undefined) validateApps(ws.apps);
      if (ws.settings !== undefined) validateSettings(ws.settings);
      if (ws.folders !== undefined && (!Array.isArray(ws.folders) || ws.folders.some((f) => !isRecord(f) || (f.appIds !== undefined && !Array.isArray(f.appIds))))) invalid();
    }
    if (state.activeWorkspaceId !== undefined && !ids.has(state.activeWorkspaceId)) invalid();
  }
};
