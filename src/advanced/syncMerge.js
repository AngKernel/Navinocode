import { SCHEMA_VERSION, DEFAULT_SETTINGS, normalizeWorkspace, normalizeTombstones, entityKey } from './workspaceModel.js';

const safeArray = (value) => (Array.isArray(value) ? value : []);
const safeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const identity = (item, fallbackPrefix, index) => {
  if (fallbackPrefix === 'app' && item?.url) {
    // URL normalizes the hostname, but paths and query values are case-sensitive.
    try { return `url:${new URL(item.url).href}`; }
    catch { return `url:${String(item.url)}`; }
  }
  return String(item?.id ?? item?.client_id ?? item?.url ?? item?.name ?? `${fallbackPrefix}-${index}`);
};

export const mergeEntityArrays = (base, incoming, prefix = 'item') => {
  const result = [];
  const positions = new Map();

  const add = (item, index, preferIncoming) => {
    if (!item || typeof item !== 'object') return;
    const key = identity(item, prefix, index);
    if (!positions.has(key)) {
      positions.set(key, result.length);
      result.push({ ...item });
      return;
    }
    const position = positions.get(key);
    result[position] = preferIncoming
      ? { ...result[position], ...item }
      : { ...item, ...result[position] };
  };

  safeArray(base).forEach((item, index) => add(item, index, false));
  safeArray(incoming).forEach((item, index) => add(item, index, true));
  return result;
};

const later = (a, b) => (Date.parse(a) || 0) > (Date.parse(b) || 0);
const mergeDeleted = (a, b) => {
  const left = normalizeTombstones(a);
  const right = normalizeTombstones(b);
  return Object.fromEntries(Object.keys(left).map((group) => [group, {
    ...left[group], ...Object.fromEntries(Object.entries(right[group]).map(([key, at]) =>
      [key, later(left[group][key], at) ? left[group][key] : at])),
  }]));
};
const normalizeForMerge = (state) => ({
  ...safeObject(state),
  workspaces: safeArray(state?.workspaces).map((ws, index) => ({
    ...normalizeWorkspace(ws, index),
    // Do not turn an omitted compact asset/partial setting into a clearing value.
    settings: { ...safeObject(ws.settings) },
  })),
});
const mergeVersioned = (left, right, deleted, scope, legacy = false) => {
  const entries = new Map();
  for (const item of [...safeArray(left), ...safeArray(right)]) {
    if (!item || deleted[scope ? entityKey(scope, item.id) : String(item.id)]) continue;
    const key = String(item.id);
    const old = entries.get(key);
    const winner = !old || legacy || !later(old.updatedAt, item.updatedAt) ? { ...old, ...item } : { ...item, ...old };
    entries.set(key, winner);
  }
  return [...entries.values()];
};
const mergeAdvancedState = (base, incoming) => {
  if (!base && !incoming) return undefined;
  if (Math.max(Number(base?.schemaVersion || 0), Number(incoming?.schemaVersion || 0)) > SCHEMA_VERSION) {
    throw new Error('配置来自更新版本，请先升级 Navinocode');
  }
  const left = normalizeForMerge(base);
  const right = normalizeForMerge(incoming);
  const legacy = (base && Number(base.schemaVersion || 0) < SCHEMA_VERSION) || (incoming && Number(incoming.schemaVersion || 0) < SCHEMA_VERSION);
  const tombstones = mergeDeleted(base?.tombstones, incoming?.tombstones);
  const workspaceHeaders = mergeVersioned(left.workspaces, right.workspaces, tombstones.workspaces, '', legacy);
  const workspaces = workspaceHeaders.map((header) => {
    const a = left.workspaces.find((ws) => ws.id === header.id);
    const b = right.workspaces.find((ws) => ws.id === header.id);
    const aApps = safeArray(a?.apps).filter((app) => !tombstones.apps[entityKey(header.id, app.id)]);
    const bApps = safeArray(b?.apps).filter((app) => !tombstones.apps[entityKey(header.id, app.id)]);
    let apps = legacy ? mergeEntityArrays(aApps, bApps, 'app') : mergeVersioned(aApps, bApps, tombstones.apps, header.id);
    const folders = mergeVersioned(a?.folders, b?.folders, tombstones.folders, header.id, legacy);
    const folderIds = new Set(folders.map((folder) => folder.id));
    // Unrelated setting edits must not revert a rename or a Dock reorder.
    const nameSource = !b || (!legacy && a && later(a.nameUpdatedAt, b.nameUpdatedAt)) ? a : b;
    const orderSource = !b || (!legacy && a && later(a.orderUpdatedAt, b.orderUpdatedAt)) ? a : b;
    const order = new Map(safeArray(orderSource?.apps).map((app, i) => [String(app.id), i]));
    apps.sort((x, y) => (order.get(x.id) ?? Infinity) - (order.get(y.id) ?? Infinity));
    apps = apps.map((app) => ({ ...app, folderId: folderIds.has(app.folderId) ? app.folderId : null }));
    const settings = {};
    const settingVersions = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const aValue = a?.settings?.[key];
      const bValue = b?.settings?.[key];
      const aTime = a?.settingVersions?.[key] || a?.updatedAt || '';
      const bTime = b?.settingVersions?.[key] || b?.updatedAt || '';
      const useB = bValue !== undefined && (aValue === undefined || legacy || !later(aTime, bTime));
      if (aValue !== undefined || bValue !== undefined) settings[key] = useB ? bValue : aValue;
      if (aTime || bTime) settingVersions[key] = useB ? bTime : aTime;
    }
    settings.todos = mergeVersioned(a?.settings?.todos, b?.settings?.todos, tombstones.todos, header.id, legacy);
    return { ...header, name: nameSource?.name || header.name, nameUpdatedAt: nameSource?.nameUpdatedAt,
      orderUpdatedAt: orderSource?.orderUpdatedAt, apps, folders, settings, settingVersions };
  });
  if (!workspaces.length) throw new Error('两端删除操作冲突，不能删除全部工作区；本地数据未覆盖');
  const requestedId = right.activeWorkspaceId || left.activeWorkspaceId;
  return {
    ...left, ...right, schemaVersion: SCHEMA_VERSION, tombstones, workspaces,
    activeWorkspaceId: workspaces.some((ws) => ws.id === requestedId) ? requestedId : workspaces[0].id,
    updatedAt: later(left.updatedAt, right.updatedAt) ? left.updatedAt : right.updatedAt,
  };
};

// Older cloud/config payloads have only top-level fields. Attach them to the
// known active workspace before merging, rather than dropping them when the
// legacy projection is rebuilt from advancedState.
const withLegacyWorkspace = (snapshot, reference) => {
  if (snapshot.advancedState || !reference.advancedState) return snapshot;
  const state = reference.advancedState;
  const active = safeArray(state.workspaces).find((workspace) => workspace.id === state.activeWorkspaceId);
  if (!active) return snapshot;
  const settings = {};
  [
    'todos', 'componentSettings', 'searchEngine', 'onlineSuggestionsEnabled',
    'backgroundImage', 'backgroundBrightness', 'backgroundBlur', 'backgroundOverlay',
    'themeMode', 'bottomCount', 'widgetPositions', 'widgetPins', 'pomodoroMinutes',
  ].forEach((key) => {
    if (snapshot[key] !== undefined) settings[key] = snapshot[key];
  });
  if (snapshot.apps === undefined && Object.keys(settings).length === 0) return snapshot;
  return {
    ...snapshot,
    advancedState: {
      schemaVersion: 3,
      activeWorkspaceId: active.id,
      workspaces: [{ id: active.id, apps: safeArray(snapshot.apps), folders: [], settings }],
      updatedAt: state.updatedAt,
    },
  };
};

export const mergeSnapshots = (base, incoming) => {
  const left = withLegacyWorkspace(safeObject(base), safeObject(incoming));
  const right = withLegacyWorkspace(safeObject(incoming), safeObject(base));
  const merged = {
    ...left,
    ...right,
    apps: mergeEntityArrays(left.apps, right.apps, 'app'),
    todos: mergeEntityArrays(left.todos, right.todos, 'todo'),
    componentSettings: { ...safeObject(left.componentSettings), ...safeObject(right.componentSettings) },
  };
  const advancedState = mergeAdvancedState(left.advancedState, right.advancedState);
  if (advancedState) merged.advancedState = advancedState;

  if (advancedState?.activeWorkspaceId) {
    const active = advancedState.workspaces.find((workspace) => workspace.id === advancedState.activeWorkspaceId);
    if (active) {
      // Legacy fields are a projection of the active workspace, not a union of workspaces.
      merged.apps = active.apps.filter((app) => !app.folderId);
      const settings = safeObject(active.settings);
      if (Array.isArray(settings.todos)) merged.todos = settings.todos;
      if (settings.componentSettings) merged.componentSettings = safeObject(settings.componentSettings);
      [
        'searchEngine',
        'onlineSuggestionsEnabled',
        'backgroundImage',
        'backgroundBrightness',
        'backgroundBlur',
        'backgroundOverlay',
        'themeMode',
        'bottomCount',
        'widgetPositions',
        'widgetPins',
        'pomodoroMinutes',
      ].forEach((key) => {
        if (settings[key] !== undefined) merged[key] = settings[key];
      });
    }
  }
  return merged;
};

export const stableSnapshotString = (value) => {
  const normalize = (item) => {
    if (Array.isArray(item)) return item.map(normalize);
    if (!item || typeof item !== 'object') return item;
    return Object.keys(item).sort().reduce((output, key) => {
      output[key] = normalize(item[key]);
      return output;
    }, {});
  };
  // Active workspace and top-level compatibility fields are projections, not
  // synchronized user data. Different devices may view different scenes.
  if (value?.advancedState?.schemaVersion === SCHEMA_VERSION) {
    const { activeWorkspaceId, ...state } = value.advancedState;
    return JSON.stringify(normalize(state));
  }
  return JSON.stringify(normalize(value));
};

export const snapshotsDiffer = (a, b) => stableSnapshotString(a) !== stableSnapshotString(b);
