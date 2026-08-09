const safeArray = (value) => (Array.isArray(value) ? value : []);
const safeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const identity = (item, fallbackPrefix, index) => {
  if (fallbackPrefix === 'app' && item?.url) return `url:${String(item.url).toLowerCase()}`;
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

const mergeTombstoneGroup = (base, incoming) => {
  const result = { ...safeObject(base) };
  Object.entries(safeObject(incoming)).forEach(([key, value]) => {
    const current = result[key];
    if (!current || String(value || '') > String(current || '')) result[key] = value;
  });
  return result;
};

const mergeTombstones = (base, incoming) => ({
  workspaces: mergeTombstoneGroup(base?.workspaces, incoming?.workspaces),
  folders: mergeTombstoneGroup(base?.folders, incoming?.folders),
  apps: mergeTombstoneGroup(base?.apps, incoming?.apps),
});

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

const entityKey = (workspaceId, entityId) => `${String(workspaceId)}:${String(entityId)}`;

const mergeWorkspaces = (base, incoming, tombstones) => {
  const workspaces = mergeEntityArrays(base, incoming, 'workspace');
  return workspaces
    .filter((workspace) => !tombstones.workspaces[String(workspace.id)])
    .map((workspace) => {
      const baseWorkspace = safeArray(base).find((item) => String(item?.id) === String(workspace.id));
      const incomingWorkspace = safeArray(incoming).find((item) => String(item?.id) === String(workspace.id));
      const apps = mergeEntityArrays(baseWorkspace?.apps, incomingWorkspace?.apps, 'app')
        .filter((app) => !tombstones.apps[entityKey(workspace.id, app.id)]);
      const folders = mergeEntityArrays(baseWorkspace?.folders, incomingWorkspace?.folders, 'folder')
        .filter((folder) => !tombstones.folders[entityKey(workspace.id, folder.id)]);
      const validFolderIds = new Set(folders.map((folder) => String(folder.id)));

      return {
        ...baseWorkspace,
        ...incomingWorkspace,
        ...workspace,
        apps: apps.map((app) => ({
          ...app,
          folderId: app?.folderId && validFolderIds.has(String(app.folderId)) ? String(app.folderId) : null,
        })),
        folders: folders.map(({ appIds, ...folder }) => folder),
        settings: mergeWorkspaceSettings(baseWorkspace?.settings, incomingWorkspace?.settings),
        updatedAt: incomingWorkspace?.updatedAt || baseWorkspace?.updatedAt || workspace.updatedAt,
      };
    });
};

const mergeAdvancedState = (base, incoming) => {
  if (!base && !incoming) return undefined;
  const baseState = safeObject(base);
  const incomingState = safeObject(incoming);
  const tombstones = mergeTombstones(baseState.tombstones, incomingState.tombstones);
  const workspaces = mergeWorkspaces(baseState.workspaces, incomingState.workspaces, tombstones);
  const requestedActiveId = incomingState.activeWorkspaceId || baseState.activeWorkspaceId;
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === requestedActiveId)
    ? requestedActiveId
    : workspaces[0]?.id;
  return {
    ...baseState,
    ...incomingState,
    schemaVersion: Math.max(Number(baseState.schemaVersion || 0), Number(incomingState.schemaVersion || 0), 4),
    activeWorkspaceId,
    workspaces,
    tombstones,
    updatedAt: incomingState.updatedAt || baseState.updatedAt,
  };
};

export const mergeSnapshots = (base, incoming) => {
  const left = safeObject(base);
  const right = safeObject(incoming);
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
      merged.apps = safeArray(active.apps).filter((app) => !app?.folderId);
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
