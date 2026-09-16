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

const mergeFolders = (base, incoming) => {
  const folders = mergeEntityArrays(base, incoming, 'folder');
  return folders.map((folder) => {
    const baseFolder = safeArray(base).find((item) => String(item?.id) === String(folder.id));
    const incomingFolder = safeArray(incoming).find((item) => String(item?.id) === String(folder.id));
    return {
      ...folder,
      appIds: [...new Set([
        ...safeArray(baseFolder?.appIds).map(String),
        ...safeArray(incomingFolder?.appIds).map(String),
      ])],
    };
  });
};

const mergeWorkspaceSettings = (base, incoming) => {
  const left = safeObject(base);
  const right = safeObject(incoming);
  return {
    ...left,
    ...right,
    todos: mergeEntityArrays(left.todos, right.todos, 'todo'),
    componentSettings: {
      ...safeObject(left.componentSettings),
      ...safeObject(right.componentSettings),
    },
  };
};

const remapFolderApps = (folders, sourceApps, mergedApps) => {
  const mergedIds = new Map(mergedApps.map((app, index) => [identity(app, 'app', index), String(app.id)]));
  const sourceIds = new Map(safeArray(sourceApps).map((app, index) => [String(app?.id), mergedIds.get(identity(app, 'app', index))]));
  return safeArray(folders).map((folder) => ({
    ...folder,
    appIds: [...new Set(safeArray(folder?.appIds).map((id) => sourceIds.get(String(id)) || String(id)))],
  }));
};

const mergeWorkspaces = (base, incoming) => {
  const workspaces = mergeEntityArrays(base, incoming, 'workspace');
  return workspaces.map((workspace) => {
    const baseWorkspace = safeArray(base).find((item) => String(item?.id) === String(workspace.id));
    const incomingWorkspace = safeArray(incoming).find((item) => String(item?.id) === String(workspace.id));
    const apps = mergeEntityArrays(baseWorkspace?.apps, incomingWorkspace?.apps, 'app');
    return {
      ...baseWorkspace,
      ...incomingWorkspace,
      ...workspace,
      apps,
      folders: mergeFolders(
        remapFolderApps(baseWorkspace?.folders, baseWorkspace?.apps, apps),
        remapFolderApps(incomingWorkspace?.folders, incomingWorkspace?.apps, apps),
      ),
      settings: mergeWorkspaceSettings(baseWorkspace?.settings, incomingWorkspace?.settings),
      updatedAt: incomingWorkspace?.updatedAt || baseWorkspace?.updatedAt || workspace.updatedAt,
    };
  });
};

const mergeAdvancedState = (base, incoming) => {
  if (!base && !incoming) return undefined;
  const baseState = safeObject(base);
  const incomingState = safeObject(incoming);
  const workspaces = mergeWorkspaces(baseState.workspaces, incomingState.workspaces);
  const requestedActiveId = incomingState.activeWorkspaceId || baseState.activeWorkspaceId;
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === requestedActiveId)
    ? requestedActiveId
    : workspaces[0]?.id;
  return {
    ...baseState,
    ...incomingState,
    schemaVersion: Math.max(Number(baseState.schemaVersion || 0), Number(incomingState.schemaVersion || 0), 3),
    activeWorkspaceId,
    workspaces,
    updatedAt: incomingState.updatedAt || baseState.updatedAt,
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
      schemaVersion: state.schemaVersion,
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
      merged.apps = active.apps;
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
  return JSON.stringify(normalize(value));
};

export const snapshotsDiffer = (a, b) => stableSnapshotString(a) !== stableSnapshotString(b);
