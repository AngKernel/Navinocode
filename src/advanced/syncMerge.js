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

const mergeWorkspaces = (base, incoming) => {
  const workspaces = mergeEntityArrays(base, incoming, 'workspace');
  return workspaces.map((workspace) => {
    const baseWorkspace = safeArray(base).find((item) => String(item?.id) === String(workspace.id));
    const incomingWorkspace = safeArray(incoming).find((item) => String(item?.id) === String(workspace.id));
    return {
      ...baseWorkspace,
      ...incomingWorkspace,
      ...workspace,
      apps: mergeEntityArrays(baseWorkspace?.apps, incomingWorkspace?.apps, 'app'),
      folders: mergeFolders(baseWorkspace?.folders, incomingWorkspace?.folders),
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
    schemaVersion: Math.max(Number(baseState.schemaVersion || 0), Number(incomingState.schemaVersion || 0), 2),
    activeWorkspaceId,
    workspaces,
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
    if (active) merged.apps = mergeEntityArrays(merged.apps, active.apps, 'app');
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
