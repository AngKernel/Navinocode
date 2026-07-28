const ADVANCED_STATE_KEY = 'navinocode_advanced_state';
const DEVICE_ID_KEY = 'navinocode_device_id';
const NATIVE_SYNC_ENABLED_KEY = 'navinocode_native_sync_enabled';

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

export const getDeviceId = () => {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = makeId('device');
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
};

export const readLegacyApps = () => {
  const apps = safeParse(localStorage.getItem('apps'), []);
  return Array.isArray(apps) ? apps : [];
};

export const createWorkspace = (name, apps = []) => ({
  id: makeId('workspace'),
  name: String(name || '新工作空间').trim() || '新工作空间',
  apps: Array.isArray(apps) ? apps : [],
  folders: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

const normalizeFolder = (folder) => ({
  id: folder?.id || makeId('folder'),
  name: String(folder?.name || '文件夹'),
  appIds: Array.isArray(folder?.appIds) ? [...new Set(folder.appIds.map(String))] : [],
});

const normalizeWorkspace = (workspace, fallbackApps = []) => ({
  id: workspace?.id || makeId('workspace'),
  name: String(workspace?.name || '工作空间'),
  apps: Array.isArray(workspace?.apps) ? workspace.apps : fallbackApps,
  folders: Array.isArray(workspace?.folders) ? workspace.folders.map(normalizeFolder) : [],
  createdAt: workspace?.createdAt || nowIso(),
  updatedAt: workspace?.updatedAt || nowIso(),
});

export const loadAdvancedState = ({ captureLegacy = true } = {}) => {
  const legacyApps = readLegacyApps();
  const parsed = safeParse(localStorage.getItem(ADVANCED_STATE_KEY), null);

  if (!parsed || !Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
    const workspace = createWorkspace('默认', legacyApps);
    const initial = {
      schemaVersion: 2,
      activeWorkspaceId: workspace.id,
      workspaces: [workspace],
      updatedAt: nowIso(),
    };
    localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(initial));
    return initial;
  }

  const workspaces = parsed.workspaces.map((workspace) => normalizeWorkspace(workspace, legacyApps));
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
    ? parsed.activeWorkspaceId
    : workspaces[0].id;
  const state = {
    schemaVersion: 2,
    activeWorkspaceId,
    workspaces,
    updatedAt: parsed.updatedAt || nowIso(),
  };

  if (captureLegacy) {
    const index = state.workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
    if (index >= 0 && legacyApps.length > 0 && !sameValue(state.workspaces[index].apps, legacyApps)) {
      state.workspaces[index] = {
        ...state.workspaces[index],
        apps: legacyApps,
        updatedAt: nowIso(),
      };
      state.updatedAt = nowIso();
    }
  }

  localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(state));
  return state;
};

export const saveAdvancedState = (nextState, { writeLegacy = true, preserveUpdatedAt = false } = {}) => {
  const state = {
    ...nextState,
    schemaVersion: 2,
    updatedAt: preserveUpdatedAt && nextState.updatedAt ? nextState.updatedAt : nowIso(),
  };
  localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(state));
  if (writeLegacy) {
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    if (active) localStorage.setItem('apps', JSON.stringify(active.apps || []));
  }
  window.dispatchEvent(new CustomEvent('navinocode:advanced-state', { detail: state }));
  return state;
};

export const getActiveWorkspace = (state) =>
  state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) || state.workspaces[0];

export const captureActiveWorkspace = (state) => {
  const apps = readLegacyApps();
  const active = getActiveWorkspace(state);
  if (!active || sameValue(active.apps, apps)) return state;
  const timestamp = nowIso();
  return {
    ...state,
    updatedAt: timestamp,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, apps, updatedAt: timestamp }
        : workspace
    ),
  };
};

export const switchWorkspace = (state, workspaceId) => {
  const captured = captureActiveWorkspace(state);
  const target = captured.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) return captured;
  localStorage.setItem('apps', JSON.stringify(target.apps || []));
  localStorage.setItem('bottomCount', String(Math.min(target.apps?.length || 0, 8)));
  return saveAdvancedState({ ...captured, activeWorkspaceId: workspaceId });
};

export const addWorkspace = (state, name) => {
  const captured = captureActiveWorkspace(state);
  const workspace = createWorkspace(name, []);
  return saveAdvancedState({
    ...captured,
    activeWorkspaceId: workspace.id,
    workspaces: [...captured.workspaces, workspace],
  });
};

export const renameWorkspace = (state, workspaceId, name) => saveAdvancedState({
  ...state,
  workspaces: state.workspaces.map((workspace) => workspace.id === workspaceId
    ? { ...workspace, name: String(name || '').trim() || workspace.name, updatedAt: nowIso() }
    : workspace),
});

export const deleteWorkspace = (state, workspaceId) => {
  if (state.workspaces.length <= 1) return state;
  const captured = captureActiveWorkspace(state);
  const workspaces = captured.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const activeWorkspaceId = captured.activeWorkspaceId === workspaceId
    ? workspaces[0].id
    : captured.activeWorkspaceId;
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  localStorage.setItem('apps', JSON.stringify(active?.apps || []));
  return saveAdvancedState({ ...captured, workspaces, activeWorkspaceId });
};

export const addFolder = (state, name) => saveAdvancedState({
  ...state,
  workspaces: state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
    ? {
        ...workspace,
        folders: [...workspace.folders, normalizeFolder({ name, appIds: [] })],
        updatedAt: nowIso(),
      }
    : workspace),
});

export const renameFolder = (state, folderId, name) => saveAdvancedState({
  ...state,
  workspaces: state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
    ? {
        ...workspace,
        folders: workspace.folders.map((folder) => folder.id === folderId
          ? { ...folder, name: String(name || '').trim() || folder.name }
          : folder),
        updatedAt: nowIso(),
      }
    : workspace),
});

export const deleteFolder = (state, folderId) => saveAdvancedState({
  ...state,
  workspaces: state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
    ? {
        ...workspace,
        folders: workspace.folders.filter((folder) => folder.id !== folderId),
        updatedAt: nowIso(),
      }
    : workspace),
});

export const toggleAppInFolder = (state, folderId, appId) => saveAdvancedState({
  ...state,
  workspaces: state.workspaces.map((workspace) => workspace.id === state.activeWorkspaceId
    ? {
        ...workspace,
        folders: workspace.folders.map((folder) => {
          if (folder.id !== folderId) return folder;
          const id = String(appId);
          const contains = folder.appIds.includes(id);
          return { ...folder, appIds: contains ? folder.appIds.filter((item) => item !== id) : [...folder.appIds, id] };
        }),
        updatedAt: nowIso(),
      }
    : workspace),
});

export const captureFullSnapshot = ({ compact = false } = {}) => {
  const advancedState = captureActiveWorkspace(loadAdvancedState());
  const cleanApps = (apps) => apps.map((app) => ({
    ...app,
    icon: compact && String(app?.icon || '').startsWith('data:') ? '' : app?.icon,
  }));
  const cleanAdvanced = {
    ...advancedState,
    workspaces: advancedState.workspaces.map((workspace) => ({ ...workspace, apps: cleanApps(workspace.apps || []) })),
  };

  return {
    apps: cleanApps(readLegacyApps()),
    todos: safeParse(localStorage.getItem('todos'), []),
    componentSettings: safeParse(localStorage.getItem('componentSettings'), {}),
    searchEngine: localStorage.getItem('searchEngine') || 'bing',
    onlineSuggestionsEnabled: localStorage.getItem('onlineSuggestionsEnabled') === 'true',
    backgroundImage: compact ? '' : (localStorage.getItem('backgroundImage') || ''),
    backgroundBrightness: Number(localStorage.getItem('backgroundBrightness') || 100),
    backgroundBlur: Number(localStorage.getItem('backgroundBlur') || 0),
    backgroundOverlay: Number(localStorage.getItem('backgroundOverlay') || 24),
    themeMode: localStorage.getItem('themeMode') || 'system',
    bottomCount: localStorage.getItem('bottomCount'),
    widgetPositions: localStorage.getItem('widget_positions'),
    widgetPins: localStorage.getItem('widget_pins'),
    advancedState: cleanAdvanced,
  };
};

export const applyFullSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return;
  const jsonKeys = ['apps', 'todos', 'componentSettings'];
  jsonKeys.forEach((key) => {
    if (snapshot[key] !== undefined) localStorage.setItem(key, JSON.stringify(snapshot[key]));
  });
  const scalarKeys = [
    'searchEngine', 'onlineSuggestionsEnabled', 'backgroundImage', 'backgroundBrightness',
    'backgroundBlur', 'backgroundOverlay', 'themeMode', 'bottomCount', 'widgetPositions', 'widgetPins',
  ];
  scalarKeys.forEach((key) => {
    const value = snapshot[key];
    if (value === null || value === undefined) return;
    localStorage.setItem(key, String(value));
  });
  if (snapshot.advancedState) saveAdvancedState(snapshot.advancedState, { preserveUpdatedAt: true });
  window.dispatchEvent(new CustomEvent('navinocode:snapshot-applied'));
};

export const isNativeSyncEnabled = () => localStorage.getItem(NATIVE_SYNC_ENABLED_KEY) === 'true';
export const setNativeSyncEnabled = (enabled) => localStorage.setItem(NATIVE_SYNC_ENABLED_KEY, enabled ? 'true' : 'false');
export const ADVANCED_KEYS = { ADVANCED_STATE_KEY, NATIVE_SYNC_ENABLED_KEY };
