import { normalizeState, getActiveWorkspace, getRootApps } from './workspaceModel.js';

// Human-readable diffs deliberately exclude credentials, revisions and tombstones.
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
export const stableJSON = (value) => JSON.stringify(value, function (key, item) {
  return record(item) ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item;
});
const list = (value) => Array.isArray(value) ? value : [];
const fields = (value, keys) => Object.fromEntries(keys.map((key) => [key, value?.[key] ?? null]));
const display = (value, kind) => {
  if (value == null) return '—';
  if (kind === 'backgroundImage' || kind === 'icon') return value ? `图片/图标已设置（${String(value).length} 字符）` : '未设置';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
};
const flatten = (snapshot) => {
  const result = new Map();
  const workspaces = snapshot?.advancedState?.workspaces || (snapshot?.workspaces ? snapshot.workspaces : [{
    id: 'legacy', name: '当前工作区', apps: snapshot?.apps, folders: [], settings: snapshot,
  }]);
  const put = (key, kind, path, data) => result.set(key, { key, kind, path, data });
  for (const ws of list(workspaces)) {
    const root = String(ws.name || '工作区');
    put(`workspace:${ws.id}`, '工作区', root, { name: ws.name });
    const folders = new Map(list(ws.folders).map((folder) => [folder.id, folder.name]));
    for (const folder of list(ws.folders)) put(`folder:${ws.id}:${folder.id}`, '文件夹', `${root} / ${folder.name}`, { name: folder.name });
    for (const app of list(ws.apps)) put(`app:${ws.id}:${app.id}`, '网站', `${root} / ${folders.get(app.folderId) || '未分组'} / ${app.name || app.url}`,
      Object.fromEntries(Object.entries(app).filter(([name]) => !['id', 'updatedAt', 'createdAt'].includes(name))));
    for (const todo of list(ws.settings?.todos)) put(`todo:${ws.id}:${todo.id}`, '待办', `${root} / ${todo.text}`, fields(todo, ['text', 'completed']));
    const settings = ws.settings || {};
    for (const name of ['componentSettings', 'searchEngine', 'onlineSuggestionsEnabled', 'backgroundImage', 'backgroundBrightness',
      'backgroundBlur', 'backgroundOverlay', 'themeMode', 'bottomCount', 'widgetPositions', 'widgetPins', 'pomodoroMinutes']) {
      if (Object.hasOwn(settings, name)) put(`setting:${ws.id}:${name}`, '设置', `${root} / ${name}`, { [name]: settings[name] });
    }
    put(`order:${ws.id}`, '网站顺序', root, { order: list(ws.apps).map((app) => app.id) });
  }
  return result;
};
export const diffSnapshots = (before, after, limit = 500) => {
  const left = flatten(before); const right = flatten(after);
  const summary = { added: 0, removed: 0, changed: 0, total: 0, items: [], truncated: false };
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key); const b = right.get(key);
    if (a && b && stableJSON(a.data) === stableJSON(b.data)) continue;
    const action = !a ? 'added' : !b ? 'removed' : 'changed';
    summary[action] += 1; summary.total += 1;
    if (summary.items.length >= limit) { summary.truncated = true; continue; }
    const changes = [...new Set([...Object.keys(a?.data || {}), ...Object.keys(b?.data || {})])]
      .filter((field) => stableJSON(a?.data[field]) !== stableJSON(b?.data[field]))
      .map((field) => ({ field, before: display(a?.data[field], field), after: display(b?.data[field], field) }));
    summary.items.push({ key, action, kind: (b || a).kind, path: (b || a).path, changes });
  }
  return summary;
};
// This signature is for rejecting stale previews, not a distributed CAS.
export const previewSignature = (snapshot) => stableJSON(snapshot);
export const assertPreviewCurrent = (expected, current) => {
  if (expected !== previewSignature(current)) throw new Error('预览后本地配置已变化，请刷新预览再确认');
};
export const preserveOmittedAssets = (snapshot, local) => {
  const result = JSON.parse(JSON.stringify(snapshot));
  if (!result.advancedState) {
    if (!Object.hasOwn(result, 'backgroundImage') && Object.hasOwn(local, 'backgroundImage')) result.backgroundImage = local.backgroundImage;
    return result;
  }
  for (const ws of result.advancedState.workspaces) {
    const previous = local.advancedState?.workspaces?.find((item) => item.id === ws.id);
    ws.settings = { ...ws.settings };
    if (!Object.hasOwn(ws.settings, 'backgroundImage')) ws.settings.backgroundImage = previous?.settings?.backgroundImage || '';
    for (const app of ws.apps || []) {
      if (Object.hasOwn(app, 'icon')) continue;
      const old = previous?.apps?.find((item) => item.id === String(app.id) || item.url === app.url);
      if (old?.icon) app.icon = old.icon;
    }
  }
  result.advancedState = normalizeState(result.advancedState);
  const active = getActiveWorkspace(result.advancedState);
  return { ...result, ...active.settings, apps: getRootApps(active) };
};
