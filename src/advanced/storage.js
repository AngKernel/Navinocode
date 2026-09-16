const ADVANCED_STATE_KEY = 'navinocode_advanced_state';
const DEVICE_ID_KEY = 'navinocode_device_id';
const NATIVE_SYNC_ENABLED_KEY = 'navinocode_native_sync_enabled';

const WORKSPACE_SETTING_DEFAULTS = {
  todos: [],
  componentSettings: {
    pomodoro: false,
    heatmap: false,
    todo: false,
  },
  searchEngine: 'bing',
  onlineSuggestionsEnabled: false,
  backgroundImage: '',
  backgroundBrightness: 100,
  backgroundBlur: 0,
  backgroundOverlay: 24,
  themeMode: 'system',
  bottomCount: 8,
  widgetPositions: '',
  widgetPins: '',
  pomodoroMinutes: 25,
};

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
const clampNumber = (value, fallback, min = -Infinity, max = Infinity) => {
  // Missing values are not zero; preserve an explicitly stored 0.
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

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

export const readWorkspaceSettings = () => ({
  todos: (() => {
    const value = safeParse(localStorage.getItem('todos'), WORKSPACE_SETTING_DEFAULTS.todos);
    return Array.isArray(value) ? value : [];
  })(),
  componentSettings: (() => {
    const value = safeParse(localStorage.getItem('componentSettings'), WORKSPACE_SETTING_DEFAULTS.componentSettings);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : { ...WORKSPACE_SETTING_DEFAULTS.componentSettings };
  })(),
  searchEngine: localStorage.getItem('searchEngine') || WORKSPACE_SETTING_DEFAULTS.searchEngine,
  onlineSuggestionsEnabled: localStorage.getItem('onlineSuggestionsEnabled') === 'true',
  backgroundImage: localStorage.getItem('backgroundImage') || '',
  backgroundBrightness: clampNumber(
    localStorage.getItem('backgroundBrightness'),
    WORKSPACE_SETTING_DEFAULTS.backgroundBrightness,
    0,
    200,
  ),
  backgroundBlur: clampNumber(
    localStorage.getItem('backgroundBlur'),
    WORKSPACE_SETTING_DEFAULTS.backgroundBlur,
    0,
    20,
  ),
  backgroundOverlay: clampNumber(
    localStorage.getItem('backgroundOverlay'),
    WORKSPACE_SETTING_DEFAULTS.backgroundOverlay,
    0,
    60,
  ),
  themeMode: ['system', 'light', 'dark'].includes(localStorage.getItem('themeMode'))
    ? localStorage.getItem('themeMode')
    : WORKSPACE_SETTING_DEFAULTS.themeMode,
  bottomCount: clampNumber(localStorage.getItem('bottomCount'), WORKSPACE_SETTING_DEFAULTS.bottomCount, 0, 8),
  widgetPositions: localStorage.getItem('widget_positions') || '',
  widgetPins: localStorage.getItem('widget_pins') || '',
  pomodoroMinutes: clampNumber(
    localStorage.getItem('pomodoro_minutes'),
    WORKSPACE_SETTING_DEFAULTS.pomodoroMinutes,
    1,
    180,
  ),
});

const normalizeWorkspaceSettings = (settings, fallback = WORKSPACE_SETTING_DEFAULTS) => {
  const source = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : fallback;
  const componentSettings = source.componentSettings && typeof source.componentSettings === 'object' && !Array.isArray(source.componentSettings)
    ? source.componentSettings
    : fallback.componentSettings;

  return {
    todos: Array.isArray(source.todos) ? source.todos : (Array.isArray(fallback.todos) ? fallback.todos : []),
    componentSettings: {
      ...WORKSPACE_SETTING_DEFAULTS.componentSettings,
      ...(fallback.componentSettings || {}),
      ...componentSettings,
    },
    searchEngine: String(source.searchEngine || fallback.searchEngine || WORKSPACE_SETTING_DEFAULTS.searchEngine),
    onlineSuggestionsEnabled: source.onlineSuggestionsEnabled !== undefined
      ? Boolean(source.onlineSuggestionsEnabled)
      : Boolean(fallback.onlineSuggestionsEnabled),
    backgroundImage: String(source.backgroundImage || ''),
    backgroundBrightness: clampNumber(
      source.backgroundBrightness,
      fallback.backgroundBrightness ?? WORKSPACE_SETTING_DEFAULTS.backgroundBrightness,
      0,
      200,
    ),
    backgroundBlur: clampNumber(
      source.backgroundBlur,
      fallback.backgroundBlur ?? WORKSPACE_SETTING_DEFAULTS.backgroundBlur,
      0,
      20,
    ),
    backgroundOverlay: clampNumber(
      source.backgroundOverlay,
      fallback.backgroundOverlay ?? WORKSPACE_SETTING_DEFAULTS.backgroundOverlay,
      0,
      60,
    ),
    themeMode: ['system', 'light', 'dark'].includes(source.themeMode)
      ? source.themeMode
      : (fallback.themeMode || WORKSPACE_SETTING_DEFAULTS.themeMode),
    bottomCount: clampNumber(
      source.bottomCount,
      fallback.bottomCount ?? WORKSPACE_SETTING_DEFAULTS.bottomCount,
      0,
      8,
    ),
    widgetPositions: String(source.widgetPositions || ''),
    widgetPins: String(source.widgetPins || ''),
    pomodoroMinutes: clampNumber(
      source.pomodoroMinutes,
      fallback.pomodoroMinutes ?? WORKSPACE_SETTING_DEFAULTS.pomodoroMinutes,
      1,
      180,
    ),
  };
};

export const applyWorkspaceSettings = (settings, appCount = 0) => {
  const normalized = normalizeWorkspaceSettings(settings);
  localStorage.setItem('todos', JSON.stringify(normalized.todos));
  localStorage.setItem('componentSettings', JSON.stringify(normalized.componentSettings));
  localStorage.setItem('searchEngine', normalized.searchEngine);
  localStorage.setItem('onlineSuggestionsEnabled', normalized.onlineSuggestionsEnabled ? 'true' : 'false');

  if (normalized.backgroundImage) localStorage.setItem('backgroundImage', normalized.backgroundImage);
  else localStorage.removeItem('backgroundImage');

  localStorage.setItem('backgroundBrightness', String(normalized.backgroundBrightness));
  localStorage.setItem('backgroundBlur', String(normalized.backgroundBlur));
  localStorage.setItem('backgroundOverlay', String(normalized.backgroundOverlay));
  localStorage.setItem('themeMode', normalized.themeMode);
  localStorage.setItem('bottomCount', String(Math.min(normalized.bottomCount, Math.max(0, appCount))));

  if (normalized.widgetPositions) localStorage.setItem('widget_positions', normalized.widgetPositions);
  else localStorage.removeItem('widget_positions');

  if (normalized.widgetPins) localStorage.setItem('widget_pins', normalized.widgetPins);
  else localStorage.removeItem('widget_pins');

  localStorage.setItem('pomodoro_minutes', String(normalized.pomodoroMinutes));
};

const applyWorkspaceToLocal = (workspace) => {
  if (!workspace) return;
  const apps = Array.isArray(workspace.apps) ? workspace.apps : [];
  localStorage.setItem('apps', JSON.stringify(apps));
  applyWorkspaceSettings(workspace.settings, apps.length);
};

export const createWorkspace = (name, apps = [], settings = readWorkspaceSettings()) => ({
  id: makeId('workspace'),
  name: String(name || '新工作空间').trim() || '新工作空间',
  apps: Array.isArray(apps) ? apps : [],
  folders: [],
  settings: normalizeWorkspaceSettings(settings),
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

const normalizeFolder = (folder) => ({
  id: folder?.id || makeId('folder'),
  name: String(folder?.name || '文件夹'),
  appIds: Array.isArray(folder?.appIds) ? [...new Set(folder.appIds.map(String))] : [],
});

const normalizeWorkspace = (workspace, fallbackApps = [], fallbackSettings = WORKSPACE_SETTING_DEFAULTS) => ({
  id: workspace?.id || makeId('workspace'),
  name: String(workspace?.name || '工作空间'),
  apps: Array.isArray(workspace?.apps) ? workspace.apps : fallbackApps,
  folders: Array.isArray(workspace?.folders) ? workspace.folders.map(normalizeFolder) : [],
  settings: normalizeWorkspaceSettings(workspace?.settings, fallbackSettings),
  createdAt: workspace?.createdAt || nowIso(),
  updatedAt: workspace?.updatedAt || nowIso(),
});

export const loadAdvancedState = ({ captureLegacy = true } = {}) => {
  const legacyApps = readLegacyApps();
  const liveSettings = readWorkspaceSettings();
  const parsed = safeParse(localStorage.getItem(ADVANCED_STATE_KEY), null);

  if (!parsed || !Array.isArray(parsed.workspaces) || parsed.workspaces.length === 0) {
    const workspace = createWorkspace('默认', legacyApps, liveSettings);
    const initial = {
      schemaVersion: 3,
      activeWorkspaceId: workspace.id,
      workspaces: [workspace],
      updatedAt: nowIso(),
    };
    localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(initial));
    return initial;
  }

  const workspaces = parsed.workspaces.map((workspace) => normalizeWorkspace(workspace, legacyApps, liveSettings));
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === parsed.activeWorkspaceId)
    ? parsed.activeWorkspaceId
    : workspaces[0].id;
  const state = {
    schemaVersion: 3,
    activeWorkspaceId,
    workspaces,
    updatedAt: parsed.updatedAt || nowIso(),
  };

  if (captureLegacy) {
    const index = state.workspaces.findIndex((workspace) => workspace.id === activeWorkspaceId);
    const active = state.workspaces[index];
    if (index >= 0 && (
      !sameValue(active.apps, legacyApps) ||
      !sameValue(active.settings, liveSettings)
    )) {
      const timestamp = nowIso();
      state.workspaces[index] = {
        ...active,
        apps: legacyApps,
        settings: liveSettings,
        updatedAt: timestamp,
      };
      state.updatedAt = timestamp;
    }
  }

  localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(state));
  return state;
};

export const saveAdvancedState = (nextState, { writeLegacy = true, preserveUpdatedAt = false } = {}) => {
  const state = {
    ...nextState,
    schemaVersion: 3,
    updatedAt: preserveUpdatedAt && nextState.updatedAt ? nextState.updatedAt : nowIso(),
  };
  localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(state));
  if (writeLegacy) {
    const active = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    applyWorkspaceToLocal(active);
  }
  window.dispatchEvent(new CustomEvent('navinocode:advanced-state', { detail: state }));
  return state;
};

export const getActiveWorkspace = (state) =>
  state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) || state.workspaces[0];

export const captureActiveWorkspace = (state) => {
  const apps = readLegacyApps();
  const settings = readWorkspaceSettings();
  const active = getActiveWorkspace(state);
  if (!active || (sameValue(active.apps, apps) && sameValue(active.settings, settings))) return state;
  const timestamp = nowIso();
  return {
    ...state,
    updatedAt: timestamp,
    workspaces: state.workspaces.map((workspace) =>
      workspace.id === state.activeWorkspaceId
        ? { ...workspace, apps, settings, updatedAt: timestamp }
        : workspace
    ),
  };
};

export const switchWorkspace = (state, workspaceId) => {
  const captured = captureActiveWorkspace(state);
  const target = captured.workspaces.find((workspace) => workspace.id === workspaceId);
  if (!target) return captured;
  applyWorkspaceToLocal(target);
  return saveAdvancedState({ ...captured, activeWorkspaceId: workspaceId }, { writeLegacy: false });
};

export const addWorkspace = (state, name) => {
  const captured = captureActiveWorkspace(state);
  const workspace = createWorkspace(name, readLegacyApps(), readWorkspaceSettings());
  applyWorkspaceToLocal(workspace);
  return saveAdvancedState({
    ...captured,
    activeWorkspaceId: workspace.id,
    workspaces: [...captured.workspaces, workspace],
  }, { writeLegacy: false });
};

export const renameWorkspace = (state, workspaceId, name) => {
  const captured = captureActiveWorkspace(state);
  return saveAdvancedState({
    ...captured,
    workspaces: captured.workspaces.map((workspace) => workspace.id === workspaceId
      ? { ...workspace, name: String(name || '').trim() || workspace.name, updatedAt: nowIso() }
      : workspace),
  }, { writeLegacy: false });
};

export const deleteWorkspace = (state, workspaceId) => {
  if (state.workspaces.length <= 1) return state;
  const captured = captureActiveWorkspace(state);
  const workspaces = captured.workspaces.filter((workspace) => workspace.id !== workspaceId);
  const activeWorkspaceId = captured.activeWorkspaceId === workspaceId
    ? workspaces[0].id
    : captured.activeWorkspaceId;
  const active = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  applyWorkspaceToLocal(active);
  return saveAdvancedState({ ...captured, workspaces, activeWorkspaceId }, { writeLegacy: false });
};

const updateActiveWorkspaceMetadata = (state, update) => {
  const captured = captureActiveWorkspace(state);
  return saveAdvancedState({
    ...captured,
    workspaces: captured.workspaces.map((workspace) => workspace.id === captured.activeWorkspaceId
      ? { ...update(workspace), updatedAt: nowIso() }
      : workspace),
  }, { writeLegacy: false });
};

export const addFolder = (state, name) => updateActiveWorkspaceMetadata(state, (workspace) => ({
  ...workspace,
  folders: [...workspace.folders, normalizeFolder({ name, appIds: [] })],
}));

export const renameFolder = (state, folderId, name) => updateActiveWorkspaceMetadata(state, (workspace) => ({
  ...workspace,
  folders: workspace.folders.map((folder) => folder.id === folderId
    ? { ...folder, name: String(name || '').trim() || folder.name }
    : folder),
}));

export const deleteFolder = (state, folderId) => updateActiveWorkspaceMetadata(state, (workspace) => ({
  ...workspace,
  folders: workspace.folders.filter((folder) => folder.id !== folderId),
}));

export const toggleAppInFolder = (state, folderId, appId) => updateActiveWorkspaceMetadata(state, (workspace) => ({
  ...workspace,
  folders: workspace.folders.map((folder) => {
    if (folder.id !== folderId) return folder;
    const id = String(appId);
    const contains = folder.appIds.includes(id);
    return { ...folder, appIds: contains ? folder.appIds.filter((item) => item !== id) : [...folder.appIds, id] };
  }),
}));

export const captureFullSnapshot = ({ compact = false } = {}) => {
  const loadedState = loadAdvancedState();
  const advancedState = captureActiveWorkspace(loadedState);
  if (!sameValue(loadedState, advancedState)) {
    localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify(advancedState));
  }

  const cleanApps = (apps) => apps.map((app) => {
    const clean = { ...app };
    if (compact && String(clean.icon || '').startsWith('data:')) delete clean.icon;
    return clean;
  });
  const cleanSettings = (settings) => {
    const clean = { ...normalizeWorkspaceSettings(settings) };
    if (compact) delete clean.backgroundImage;
    return clean;
  };
  const cleanAdvanced = {
    ...advancedState,
    workspaces: advancedState.workspaces.map((workspace) => ({
      ...workspace,
      apps: cleanApps(workspace.apps || []),
      settings: cleanSettings(workspace.settings),
    })),
  };
  const activeSettings = readWorkspaceSettings();

  return {
    apps: cleanApps(readLegacyApps()),
    todos: activeSettings.todos,
    componentSettings: activeSettings.componentSettings,
    searchEngine: activeSettings.searchEngine,
    onlineSuggestionsEnabled: activeSettings.onlineSuggestionsEnabled,
    ...(compact ? {} : { backgroundImage: activeSettings.backgroundImage }),
    backgroundBrightness: activeSettings.backgroundBrightness,
    backgroundBlur: activeSettings.backgroundBlur,
    backgroundOverlay: activeSettings.backgroundOverlay,
    themeMode: activeSettings.themeMode,
    bottomCount: String(activeSettings.bottomCount),
    widgetPositions: activeSettings.widgetPositions,
    widgetPins: activeSettings.widgetPins,
    advancedState: cleanAdvanced,
  };
};

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const validateFullSnapshot = (snapshot) => {
  const invalid = () => { throw new Error('同步配置格式无效，未覆盖本地数据'); };
  if (!isRecord(snapshot)) invalid();
  const validateSettings = (settings) => {
    if (!isRecord(settings)) invalid();
    if (settings.todos !== undefined && (!Array.isArray(settings.todos) || settings.todos.some((todo) => !isRecord(todo) || typeof todo.text !== 'string'))) invalid();
    if (settings.componentSettings !== undefined && !isRecord(settings.componentSettings)) invalid();
  };
  const validateApps = (apps) => {
    if (!Array.isArray(apps) || apps.some((app) => !isRecord(app) || typeof app.url !== 'string')) invalid();
  };
  validateSettings(snapshot);
  if (snapshot.apps !== undefined) validateApps(snapshot.apps);
  if (snapshot.advancedState !== undefined) {
    const advanced = snapshot.advancedState;
    if (!isRecord(advanced) || !Array.isArray(advanced.workspaces) || !advanced.workspaces.length) invalid();
    if (Number(advanced.schemaVersion) > 3) throw new Error('同步配置版本较新，请先升级 Navinocode');
    const ids = new Set();
    advanced.workspaces.forEach((workspace) => {
      if (!isRecord(workspace) || typeof workspace.id !== 'string' || !workspace.id || ids.has(workspace.id)) invalid();
      ids.add(workspace.id);
      if (workspace.apps !== undefined) validateApps(workspace.apps);
      if (workspace.settings !== undefined) validateSettings(workspace.settings);
      if (workspace.folders !== undefined && (!Array.isArray(workspace.folders) || workspace.folders.some((folder) => !isRecord(folder) || (folder.appIds !== undefined && !Array.isArray(folder.appIds))))) invalid();
    });
    if (advanced.activeWorkspaceId !== undefined && !ids.has(advanced.activeWorkspaceId)) invalid();
  }
};

// Compact browser snapshots intentionally omit device-local image assets.
// Omission must not be interpreted as an explicit request to clear an asset.
const restoreAppIcons = (apps, localApps) => apps.map((app) => {
  if (Object.prototype.hasOwnProperty.call(app, 'icon')) return app;
  const local = localApps.find((item) => item?.url === app.url && String(item.id) === String(app.id))
    || localApps.find((item) => item?.url === app.url);
  return local?.icon ? { ...app, icon: local.icon } : app;
});

export const applyFullSnapshot = (snapshot) => {
  validateFullSnapshot(snapshot);
  const localApps = readLegacyApps();
  let advancedState;
  if (snapshot.advancedState) {
    const previous = loadAdvancedState();
    const workspaces = snapshot.advancedState.workspaces.map((workspace) => {
      const local = previous.workspaces.find((item) => item.id === workspace.id);
      const normalized = normalizeWorkspace(workspace, local?.apps || [], local?.settings || WORKSPACE_SETTING_DEFAULTS);
      // Unlike a full snapshot's empty string, an omitted background is local-only.
      if (!Object.prototype.hasOwnProperty.call(workspace.settings || {}, 'backgroundImage')) {
        normalized.settings.backgroundImage = local?.settings?.backgroundImage || '';
      }
      normalized.apps = restoreAppIcons(normalized.apps, local?.apps || []);
      return { ...workspace, ...normalized };
    });
    advancedState = {
      ...snapshot.advancedState,
      activeWorkspaceId: snapshot.advancedState.activeWorkspaceId || workspaces[0].id,
      workspaces,
    };
  }
  const jsonKeys = ['apps', 'todos', 'componentSettings'];
  jsonKeys.forEach((key) => {
    if (snapshot[key] !== undefined) {
      const value = key === 'apps' ? restoreAppIcons(snapshot.apps, localApps) : snapshot[key];
      localStorage.setItem(key, JSON.stringify(value));
    }
  });
  const scalarKeys = [
    'searchEngine', 'onlineSuggestionsEnabled', 'backgroundImage', 'backgroundBrightness',
    'backgroundBlur', 'backgroundOverlay', 'themeMode', 'bottomCount', 'widgetPositions', 'widgetPins',
  ];
  scalarKeys.forEach((key) => {
    const value = snapshot[key];
    if (value === null || value === undefined) return;
    const storageKey = key === 'widgetPositions'
      ? 'widget_positions'
      : key === 'widgetPins'
        ? 'widget_pins'
        : key;
    localStorage.setItem(storageKey, String(value));
  });
  if (advancedState) saveAdvancedState(advancedState, { preserveUpdatedAt: true });
  window.dispatchEvent(new CustomEvent('navinocode:snapshot-applied'));
};

export const isNativeSyncEnabled = () => localStorage.getItem(NATIVE_SYNC_ENABLED_KEY) === 'true';
export const setNativeSyncEnabled = (enabled) => {
  localStorage.setItem(NATIVE_SYNC_ENABLED_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('navinocode:native-sync-setting'));
};
export const ADVANCED_KEYS = { ADVANCED_STATE_KEY, NATIVE_SYNC_ENABLED_KEY };