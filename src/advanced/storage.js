import { DEFAULT_APPS, shouldMigrateDefaultApps } from './defaultApps.js';
import {
  SCHEMA_VERSION, DEFAULT_SETTINGS, array, clone, entityKey, getActiveWorkspace, getRootApps,
  isRecord, makeId, normalizeSettings, normalizeState, normalizeTombstones, normalizeWorkspace,
  parseJSON, validateFullSnapshot,
} from './workspaceModel.js';

export { getActiveWorkspace, getRootApps, validateFullSnapshot } from './workspaceModel.js';
const ADVANCED_STATE_KEY = 'navinocode_advanced_state';
const DEVICE_ID_KEY = 'navinocode_device_id';
const NATIVE_SYNC_ENABLED_KEY = 'navinocode_native_sync_enabled';
const MIGRATION_BACKUP_KEY = 'navinocode_workspace_migration_backup';
const RECOVERY_KEY = 'navinocode_workspace_recovery';
export const ADVANCED_KEYS = { ADVANCED_STATE_KEY, NATIVE_SYNC_ENABLED_KEY, MIGRATION_BACKUP_KEY, RECOVERY_KEY };
const legacyKeys = {
  todos: 'todos', componentSettings: 'componentSettings', searchEngine: 'searchEngine',
  onlineSuggestionsEnabled: 'onlineSuggestionsEnabled', backgroundImage: 'backgroundImage',
  backgroundBrightness: 'backgroundBrightness', backgroundBlur: 'backgroundBlur', backgroundOverlay: 'backgroundOverlay',
  themeMode: 'themeMode', bottomCount: 'bottomCount', widgetPositions: 'widget_positions',
  widgetPins: 'widget_pins', pomodoroMinutes: 'pomodoro_minutes',
};
let cachedRaw;
let cachedState;
const listeners = new Set();
const emit = () => {
  listeners.forEach((listener) => listener());
  window.dispatchEvent(new CustomEvent('navinocode:advanced-state', { detail: cachedState }));
};
const onStorage = (event) => {
  if (event.key === null || event.key === ADVANCED_STATE_KEY) {
    // Read the current durable record, not a possibly delayed StorageEvent value.
    loadAdvancedState();
    emit();
  }
};
export const subscribeWorkspaceStore = (listener) => {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener('storage', onStorage);
  };
};
export const getDeviceId = () => {
  const saved = localStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const id = makeId('device');
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
};
export const readLegacyApps = () => array(parseJSON(localStorage.getItem('apps'), []));
const legacySettings = () => {
  const values = {};
  for (const [key, storageKey] of Object.entries(legacyKeys)) {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) continue;
    values[key] = ['todos', 'componentSettings', 'onlineSuggestionsEnabled'].includes(key) ? parseJSON(raw, DEFAULT_SETTINGS[key]) : raw;
  }
  return values;
};
export const readWorkspaceSettings = () => {
  const raw = parseJSON(localStorage.getItem(ADVANCED_STATE_KEY), null);
  return raw?.schemaVersion === SCHEMA_VERSION ? getActiveWorkspace(loadAdvancedState()).settings : normalizeSettings(legacySettings());
};
export const createWorkspace = (name, apps = [], settings = DEFAULT_SETTINGS, folders = []) => normalizeWorkspace({
  id: makeId('workspace'), name: String(name || '新工作区').trim() || '新工作区',
  apps: clone(apps), folders: clone(folders), settings: clone(settings),
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

// The old scalar keys are read ONCE during migration. They are not a second
// source of truth and are deliberately left intact as rollback evidence.
export const loadAdvancedState = () => {
  const raw = localStorage.getItem(ADVANCED_STATE_KEY);
  if (raw !== null && raw === cachedRaw && cachedState) return cachedState;
  let parsed = parseJSON(raw, null);
  if (raw !== null && !isRecord(parsed)) throw new Error('工作区配置损坏，原数据未改动；请先导出恢复数据');
  if (Number(parsed?.schemaVersion) > SCHEMA_VERSION) throw new Error('配置来自更新版本，请升级扩展；原数据未改动');
  if (parsed?.schemaVersion !== SCHEMA_VERSION) {
    const legacy = legacySettings();
    const appsRaw = localStorage.getItem('apps');
    let apps = appsRaw == null ? clone(DEFAULT_APPS) : readLegacyApps();
    if (shouldMigrateDefaultApps(apps)) apps = clone(DEFAULT_APPS);
    if (raw != null || appsRaw != null || Object.keys(legacy).length) {
      // Abort migration on quota/security errors rather than lose the original.
      if (localStorage.getItem(MIGRATION_BACKUP_KEY) == null) {
        localStorage.setItem(MIGRATION_BACKUP_KEY, JSON.stringify({ rawState: raw, apps: appsRaw, settings: legacy, createdAt: new Date().toISOString() }));
      }
    }
    if (!isRecord(parsed) || !array(parsed.workspaces).length) {
      const workspace = createWorkspace('默认', apps, normalizeSettings(legacy));
      parsed = { activeWorkspaceId: workspace.id, workspaces: [workspace], updatedAt: workspace.updatedAt };
    } else if (Number(parsed.schemaVersion || 0) < 4) {
      // v3 main page could hold newer scalar data than the advanced-state copy.
      const activeId = parsed.activeWorkspaceId || parsed.workspaces[0]?.id;
      parsed = { ...parsed, workspaces: parsed.workspaces.map((ws) => ws.id === activeId ? {
        ...ws, ...(appsRaw == null ? {} : { apps }), settings: { ...ws.settings, ...legacy },
      } : ws) };
    }
    const state = normalizeState(parsed);
    const serialized = JSON.stringify(state);
    localStorage.setItem(ADVANCED_STATE_KEY, serialized);
    cachedRaw = serialized;
    cachedState = state;
    return state;
  }
  cachedState = normalizeState(parsed);
  cachedRaw = raw;
  return cachedState;
};
export const initializeWorkspaceStore = () => loadAdvancedState();
const timestamp = (state) => new Date(Math.max(Date.now(), (Date.parse(state.updatedAt) || 0) + 1)).toISOString();
export const saveAdvancedState = (nextState, { preserveUpdatedAt = false } = {}) => {
  const current = loadAdvancedState();
  const next = normalizeState(nextState);
  if (JSON.stringify(next) === JSON.stringify(current)) return current;
  if (!preserveUpdatedAt) next.updatedAt = timestamp(current);
  const serialized = JSON.stringify(next);
  // One durable write. Failed writes do not publish an in-memory success.
  localStorage.setItem(ADVANCED_STATE_KEY, serialized);
  cachedRaw = serialized;
  cachedState = next;
  emit();
  return next;
};
const mutate = (update) => {
  const current = loadAdvancedState();
  const draft = clone(current);
  update(draft, timestamp(current));
  return saveAdvancedState(draft);
};
const workspaceOrThrow = (state, id) => {
  const ws = state.workspaces.find((item) => item.id === id);
  if (!ws) throw new Error('该工作区已被删除，请重新选择');
  return ws;
};
const contextId = (state) => state?.activeWorkspaceId || loadAdvancedState().activeWorkspaceId;
export const captureActiveWorkspace = () => loadAdvancedState(); // legacy API, no reverse projection
export const switchWorkspace = (_state, id) => {
  const state = loadAdvancedState();
  workspaceOrThrow(state, id);
  // Selection is a view change, not a settings rewrite or a page reload.
  return saveAdvancedState({ ...state, activeWorkspaceId: id }, { preserveUpdatedAt: true });
};
export const addWorkspace = (_state, name) => mutate((state, at) => {
  const ws = createWorkspace(name); // truly blank: no copied todos, apps or layout
  ws.updatedAt = at;
  state.workspaces.push(ws);
  state.activeWorkspaceId = ws.id;
});
const copyWorkspace = (source, name, at) => {
  const folders = source.folders.map((folder) => ({ ...folder, id: makeId('folder'), updatedAt: at }));
  const folderMap = new Map(source.folders.map((folder, i) => [folder.id, folders[i].id]));
  return { ...clone(source), id: makeId('workspace'), name, createdAt: at, updatedAt: at, nameUpdatedAt: at, orderUpdatedAt: at, folders,
    apps: source.apps.map((app) => ({ ...app, id: makeId('app'), folderId: folderMap.get(app.folderId) || null, updatedAt: at })),
    settings: { ...clone(source.settings), todos: source.settings.todos.map((todo) => ({ ...todo, id: makeId('todo'), updatedAt: at })) },
    settingVersions: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, at])),
  };
};
export const duplicateWorkspace = (_state, id, name) => mutate((state, at) => {
  const source = workspaceOrThrow(state, id);
  const copy = copyWorkspace(source, String(name || `${source.name} 副本`).trim(), at);
  state.workspaces.push(copy);
  state.activeWorkspaceId = copy.id;
});
export const renameWorkspace = (_state, id, name) => mutate((state, at) => {
  const ws = workspaceOrThrow(state, id);
  const nextName = String(name || '').trim() || ws.name;
  if (nextName === ws.name) return;
  ws.name = nextName; ws.nameUpdatedAt = at;
  ws.updatedAt = at;
});
export const deleteWorkspace = (_state, id) => mutate((state) => {
  workspaceOrThrow(state, id);
  if (state.workspaces.length <= 1) throw new Error('至少保留一个工作区');
  state.tombstones.workspaces[id] = timestamp(state);
  state.workspaces = state.workspaces.filter((ws) => ws.id !== id);
  if (state.activeWorkspaceId === id) state.activeWorkspaceId = state.workspaces[0].id;
});
export const addFolder = (context, name) => mutate((state, at) => {
  const ws = workspaceOrThrow(state, contextId(context));
  ws.folders.push({ id: makeId('folder'), name: String(name || '').trim() || '新文件夹', updatedAt: at });
  ws.updatedAt = at;
});
export const renameFolder = (context, id, name) => mutate((state, at) => {
  const ws = workspaceOrThrow(state, contextId(context));
  const folder = ws.folders.find((item) => item.id === id);
  if (!folder) throw new Error('文件夹已不存在');
  folder.name = String(name || '').trim() || folder.name;
  folder.updatedAt = at;
  ws.updatedAt = at;
});
export const deleteFolder = (context, id) => mutate((state, at) => {
  const ws = workspaceOrThrow(state, contextId(context));
  ws.folders = ws.folders.filter((folder) => folder.id !== id);
  ws.apps = ws.apps.map((app) => app.folderId === id ? { ...app, folderId: null, updatedAt: at } : app);
  state.tombstones.folders[entityKey(ws.id, id)] = at;
  ws.updatedAt = at;
});
export const moveApps = (workspaceId, appIds, folderId = null) => mutate((state, at) => {
  const ws = workspaceOrThrow(state, workspaceId);
  if (folderId && !ws.folders.some((folder) => folder.id === folderId)) throw new Error('目标文件夹已不存在');
  const ids = new Set(appIds.map(String));
  ws.apps = ws.apps.map((app) => ids.has(app.id) ? { ...app, folderId: folderId || null, updatedAt: at } : app);
  ws.updatedAt = at;
});
// Compatibility for callers of the v3 membership operation, now single-location.
export const toggleAppInFolder = (context, folderId, appId) => {
  const ws = workspaceOrThrow(loadAdvancedState(), contextId(context));
  const app = ws.apps.find((item) => item.id === String(appId));
  return moveApps(ws.id, [appId], app?.folderId === folderId ? null : folderId);
};
export const setWorkspaceApps = (workspaceId, value, { rootOnly = false } = {}) => mutate((state, at) => {
  const ws = workspaceOrThrow(state, workspaceId);
  const previous = rootOnly ? getRootApps(ws) : ws.apps;
  const requested = typeof value === 'function' ? value(clone(previous)) : value;
  if (!Array.isArray(requested)) throw new Error('网站列表无效');
  const apps = normalizeWorkspace({ ...ws, apps: requested.map((app) => ({
    ...app, id: app.id ?? makeId('app'), ...(rootOnly ? { folderId: null } : {}),
  })) }).apps.map((app) => {
    const old = ws.apps.find((item) => item.id === app.id);
    const same = old && JSON.stringify({ ...old, updatedAt: '' }) === JSON.stringify({ ...app, updatedAt: '' });
    return { ...app, updatedAt: same ? old.updatedAt : at };
  });
  const kept = new Set(apps.map((app) => app.id));
  previous.forEach((app) => { if (!kept.has(app.id)) state.tombstones.apps[entityKey(ws.id, app.id)] = at; });
  const nextApps = rootOnly ? [...apps, ...ws.apps.filter((app) => app.folderId)] : apps;
  if (JSON.stringify(ws.apps) === JSON.stringify(nextApps)) return;
  if (JSON.stringify(ws.apps.map((app) => app.id)) !== JSON.stringify(nextApps.map((app) => app.id))) ws.orderUpdatedAt = at;
  ws.apps = nextApps;
  ws.updatedAt = at;
});
export const setWorkspaceSetting = (workspaceId, key, value) => mutate((state, at) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) throw new Error('未知工作区设置');
  const ws = workspaceOrThrow(state, workspaceId);
  const next = typeof value === 'function' ? value(clone(ws.settings[key])) : value;
  const settings = normalizeSettings({ ...ws.settings, [key]: next });
  if (JSON.stringify(settings[key]) === JSON.stringify(ws.settings[key])) return;
  if (key === 'todos') {
    const kept = new Set(settings.todos.map((todo) => todo.id));
    ws.settings.todos.forEach((todo) => { if (!kept.has(todo.id)) state.tombstones.todos[entityKey(ws.id, todo.id)] = at; });
    settings.todos = settings.todos.map((todo) => {
      const old = ws.settings.todos.find((item) => item.id === todo.id);
      return { ...todo, updatedAt: old && old.text === todo.text && old.completed === todo.completed ? old.updatedAt || at : at };
    });
  }
  ws.settings = settings;
  ws.settingVersions[key] = at;
  ws.updatedAt = at;
});
export const applyWorkspaceSettings = (settings) => {
  const state = loadAdvancedState();
  return mutate((draft, at) => {
    const ws = workspaceOrThrow(draft, state.activeWorkspaceId);
    ws.settings = normalizeSettings(settings, ws.settings);
    ws.settingVersions = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, at]));
    ws.updatedAt = at;
  });
};
export const captureFullSnapshot = ({ compact = false } = {}) => {
  const state = clone(loadAdvancedState());
  if (compact) state.workspaces.forEach((ws) => {
    delete ws.settings.backgroundImage;
    ws.apps.forEach((app) => { if (String(app.icon || '').startsWith('data:')) delete app.icon; });
  });
  const active = getActiveWorkspace(state);
  return { ...active.settings, apps: getRootApps(active), advancedState: state };
};
export const applyFullSnapshot = (snapshot, { selectWorkspace = false } = {}) => {
  validateFullSnapshot(snapshot);
  const current = loadAdvancedState();
  let next;
  if (snapshot.advancedState) {
    const incoming = clone(snapshot.advancedState);
    incoming.workspaces = incoming.workspaces.map((ws) => {
      const local = current.workspaces.find((item) => item.id === ws.id);
      const settings = { ...ws.settings };
      if (!Object.prototype.hasOwnProperty.call(settings, 'backgroundImage')) settings.backgroundImage = local?.settings.backgroundImage || '';
      const apps = array(ws.apps).map((app) => {
        if (Object.prototype.hasOwnProperty.call(app, 'icon')) return app;
        const old = local?.apps.find((item) => item.id === String(app.id) || item.url === app.url);
        return old?.icon ? { ...app, icon: old.icon } : app;
      });
      return { ...ws, settings, apps };
    });
    next = normalizeState(incoming);
    if (!selectWorkspace && next.workspaces.some((ws) => ws.id === current.activeWorkspaceId)) next.activeWorkspaceId = current.activeWorkspaceId;
  } else {
    next = clone(current);
    const ws = getActiveWorkspace(next);
    ws.settings = normalizeSettings(snapshot, ws.settings);
    if (snapshot.apps) ws.apps = [...snapshot.apps.map((app) => ({ ...app, folderId: null })), ...ws.apps.filter((app) => app.folderId)];
  }
  if (JSON.stringify(next) !== JSON.stringify(current)) saveRecoveryPoint('同步应用前');
  const saved = saveAdvancedState(next, { preserveUpdatedAt: true });
  window.dispatchEvent(new CustomEvent('navinocode:snapshot-applied'));
  return saved;
};
export const saveRecoveryPoint = (reason) => {
  const record = { reason, createdAt: new Date().toISOString(), state: loadAdvancedState() };
  localStorage.setItem(RECOVERY_KEY, JSON.stringify(record));
  return record;
};
export const getRecoveryPoint = () => parseJSON(localStorage.getItem(RECOVERY_KEY), null);
export const restoreRecoveryPoint = () => {
  const point = getRecoveryPoint();
  if (!point?.state) throw new Error('暂无恢复点');
  validateFullSnapshot({ advancedState: point.state });
  const previous = clone(loadAdvancedState());
  saveRecoveryPoint('恢复前');
  return mutate((state, at) => {
    previous.workspaces.forEach((ws) => { state.tombstones.workspaces[ws.id] = at; });
    state.workspaces = normalizeState(point.state).workspaces.map((ws) => copyWorkspace(ws, ws.name, at));
    state.activeWorkspaceId = state.workspaces[0].id;
  });
};
export const importFullSnapshot = (snapshot) => {
  validateFullSnapshot(snapshot);
  // Prepare everything before either the backup or canonical state is written.
  if (snapshot.advancedState) normalizeState(snapshot.advancedState);
  const prepared = snapshot.advancedState ? normalizeState(snapshot.advancedState).workspaces
    : [createWorkspace('导入的工作区', snapshot.apps || [], normalizeSettings(snapshot))];
  saveRecoveryPoint('导入前');
  return mutate((state, at) => {
    state.workspaces.forEach((ws) => { state.tombstones.workspaces[ws.id] = at; });
    state.workspaces = prepared.map((ws) => copyWorkspace(ws, ws.name, at));
    const index = snapshot.advancedState?.workspaces.findIndex((ws) => ws.id === snapshot.advancedState.activeWorkspaceId) ?? 0;
    state.activeWorkspaceId = state.workspaces[Math.max(0, index)]?.id || state.workspaces[0].id;
  });
};
// Undo is conditional: a stale toast may never overwrite a later edit/sync.
// Deleted IDs stay tombstoned. Restored entities get new IDs.
export const withUndo = (operation) => {
  const before = clone(loadAdvancedState());
  operation();
  const after = clone(loadAdvancedState());
  return () => {
    const current = loadAdvancedState();
    if (JSON.stringify(current) !== JSON.stringify(after)) throw new Error('配置已有新的修改，不能撤销这次旧操作');
    return mutate((draft, at) => {
      draft.workspaces = before.workspaces.map((ws) => {
        const existing = after.workspaces.find((item) => item.id === ws.id);
        if (!existing) return copyWorkspace(ws, ws.name, at);
        const folders = ws.folders.map((folder) => ({ ...folder,
          id: existing.folders.some((item) => item.id === folder.id) ? folder.id : makeId('folder'), updatedAt: at,
        }));
        const map = new Map(ws.folders.map((folder, i) => [folder.id, folders[i].id]));
        return { ...clone(ws), folders, updatedAt: at, nameUpdatedAt: at, orderUpdatedAt: at,
          settingVersions: Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((key) => [key, at])),
          apps: ws.apps.map((app) => ({ ...app, id: existing.apps.some((item) => item.id === app.id) ? app.id : makeId('app'), folderId: map.get(app.folderId) || null, updatedAt: at })),
          settings: { ...clone(ws.settings), todos: ws.settings.todos.map((todo) => ({ ...todo, id: existing.settings.todos.some((item) => item.id === todo.id) ? todo.id : makeId('todo'), updatedAt: at })) },
        };
      });
      const index = before.workspaces.findIndex((ws) => ws.id === before.activeWorkspaceId);
      draft.activeWorkspaceId = draft.workspaces[index]?.id || draft.workspaces[0].id;
    });
  };
};
export const isNativeSyncEnabled = () => localStorage.getItem(NATIVE_SYNC_ENABLED_KEY) === 'true';
export const setNativeSyncEnabled = (enabled) => {
  localStorage.setItem(NATIVE_SYNC_ENABLED_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('navinocode:native-sync-setting'));
};
