import { entityKey, makeId } from './workspaceModel.js';
import { invokeChrome, requestPermissions, safeWebsiteUrl } from './browserApi.js';

export const IMPORT_FILE_BYTES = 2 * 1024 * 1024;
export const IMPORT_LIMIT = 1000;
const findWorkspace = (state, id) => {
  const ws = state.workspaces.find((item) => item.id === id);
  if (!ws) throw new Error('工作区已不存在，请刷新预览');
  return ws;
};
const validateFolder = (workspace, folderId) => {
  if (folderId && !workspace.folders.some((folder) => folder.id === folderId)) throw new Error('目标文件夹已不存在，请重新选择');
};
export const previewTransfer = (state, sourceId, ids, targetId, folderId = null, duplicatePolicy = 'skip') => {
  if (!['skip', 'keep'].includes(duplicatePolicy)) throw new Error('无效的重复项处理方式');
  const source = findWorkspace(state, sourceId); const target = findWorkspace(state, targetId);
  validateFolder(target, folderId);
  const selected = new Set(ids.map(String));
  if (!selected.size || selected.size > IMPORT_LIMIT) throw new Error(`请选择 1～${IMPORT_LIMIT} 个网站`);
  const apps = source.apps.filter((app) => selected.has(app.id));
  if (apps.length !== selected.size) throw new Error('选中的网站已有变动，请重新选择');
  const existing = new Set(target.apps.filter((app) => sourceId !== targetId || !selected.has(app.id))
    .map((app) => safeWebsiteUrl(app.url)).filter(Boolean));
  const moving = []; const skipped = [];
  for (const app of apps) {
    const url = safeWebsiteUrl(app.url);
    if (!url) { skipped.push({ app, reason: '网址无效，保留在原位置' }); continue; }
    if (sourceId === targetId && app.folderId === (folderId || null)) { skipped.push({ app, reason: '已在目标目录' }); continue; }
    if (duplicatePolicy === 'skip' && existing.has(url)) { skipped.push({ app, reason: '目标工作区已有该网址，保留在原位置' }); continue; }
    moving.push(app); existing.add(url);
  }
  return { moving, skipped, sourceName: source.name, targetName: target.name,
    folderName: target.folders.find((folder) => folder.id === folderId)?.name || '未分组' };
};
export const transferIntoDraft = (state, at, sourceId, ids, targetId, folderId = null, duplicatePolicy = 'skip') => {
  const plan = previewTransfer(state, sourceId, ids, targetId, folderId, duplicatePolicy);
  if (!plan.moving.length) return plan;
  const source = findWorkspace(state, sourceId); const target = findWorkspace(state, targetId);
  const movingIds = new Set(plan.moving.map((app) => app.id));
  if (sourceId === targetId) {
    source.apps = source.apps.map((app) => movingIds.has(app.id) ? { ...app, folderId: folderId || null, updatedAt: at } : app);
  } else {
    for (const app of plan.moving) {
      state.tombstones.apps[entityKey(sourceId, app.id)] = at;
      // New IDs also make a later move back safe in the presence of tombstones.
      target.apps.push({ ...app, id: makeId('app'), folderId: folderId || null, updatedAt: at });
    }
    source.apps = source.apps.filter((app) => !movingIds.has(app.id));
    target.updatedAt = at; target.orderUpdatedAt = at;
  }
  source.updatedAt = at; source.orderUpdatedAt = at;
  return plan;
};

export const flattenBookmarkTree = (tree) => {
  const roots = Array.isArray(tree) ? tree : tree?.roots ? Object.values(tree.roots) : tree?.bookmarks || (tree?.url || tree?.children ? [tree] : null);
  if (!Array.isArray(roots)) throw new Error('书签 JSON 格式不支持，需要书签树或网址数组');
  const stack = roots.map((node) => ({ node, path: [], depth: 0 })).reverse();
  const rows = []; let count = 0;
  while (stack.length) {
    const { node, path, depth } = stack.pop();
    if (++count > 10000 || depth > 32) throw new Error('书签树过大或层级过深，请分批导入');
    if (!node || typeof node !== 'object') throw new Error('书签节点格式无效');
    if (Object.hasOwn(node, 'url')) {
      if (rows.length >= IMPORT_LIMIT) throw new Error(`每批最多 ${IMPORT_LIMIT} 条书签，请分批导入`);
      rows.push({ id: `bookmark-${rows.length}`, title: String(node.title || node.name || '').slice(0, 200), url: node.url, path });
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error('书签子节点格式无效');
      const title = String(node.title || node.name || '').trim().slice(0, 120);
      const nextPath = title ? [...path, title] : path;
      for (let i = node.children.length - 1; i >= 0; i--) stack.push({ node: node.children[i], path: nextPath, depth: depth + 1 });
    }
  }
  return rows;
};
export const readBrowserBookmarks = async () => {
  await requestPermissions(['bookmarks']);
  return flattenBookmarkTree(await invokeChrome(chrome.bookmarks, 'getTree'));
};
export const parseBookmarkFile = (text) => {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > IMPORT_FILE_BYTES) throw new Error('书签文件最大为 2 MiB');
  if (!text.trim().startsWith('<')) {
    let value; try { value = JSON.parse(text); } catch { throw new Error('书签文件不是有效的 HTML 或 JSON'); }
    return flattenBookmarkTree(value);
  }
  // Detached template contents are inert: no script execution, DOM insertion,
  // or loading of imported page resources. Only anchor text/href is extracted.
  const template = document.createElement('template');
  template.innerHTML = text;
  const anchors = [...template.content.querySelectorAll('a[href]')];
  if (!anchors.length) throw new Error('HTML 文件中没有书签链接');
  if (anchors.length > IMPORT_LIMIT) throw new Error(`每批最多 ${IMPORT_LIMIT} 条书签，请分批导入`);
  const heading = (dl) => {
    const parent = dl.parentElement;
    if (parent?.tagName === 'DT') {
      const h = [...parent.children].find((item) => item.tagName === 'H3');
      if (h) return h.textContent;
    }
    let previous = dl.previousElementSibling;
    if (previous?.tagName === 'P' && !previous.textContent.trim()) previous = previous.previousElementSibling;
    if (previous?.tagName === 'H3') return previous.textContent;
    if (previous?.tagName === 'DT') return [...previous.children].find((item) => item.tagName === 'H3')?.textContent || '';
    return '';
  };
  return anchors.map((anchor, i) => {
    const path = []; let parent = anchor.parentElement; let depth = 0;
    while (parent) {
      if (++depth > 128) throw new Error('HTML 书签层级过深');
      if (parent.tagName === 'DL') { const name = String(heading(parent) || '').trim().slice(0, 120); if (name) path.unshift(name); }
      parent = parent.parentElement;
    }
    return { id: `bookmark-${i}`, title: anchor.textContent.trim().slice(0, 200), url: anchor.getAttribute('href'), path };
  });
};
export const previewBookmarkImport = (state, workspaceId, rows, { folderId = null, preserveFolders = true, duplicatePolicy = 'skip' } = {}) => {
  if (!Array.isArray(rows) || rows.length > IMPORT_LIMIT) throw new Error(`每批最多 ${IMPORT_LIMIT} 条书签`);
  if (!['skip', 'keep'].includes(duplicatePolicy)) throw new Error('无效的重复项处理方式');
  const ws = findWorkspace(state, workspaceId); validateFolder(ws, folderId);
  const seen = new Set(ws.apps.map((app) => safeWebsiteUrl(app.url)).filter(Boolean));
  const explicitName = ws.folders.find((folder) => folder.id === folderId)?.name;
  return rows.map((row, i) => {
    const url = safeWebsiteUrl(row?.url); const duplicate = url && seen.has(url);
    if (url) seen.add(url);
    const path = Array.isArray(row?.path) ? row.path.filter((part) => typeof part === 'string' && part.trim()).slice(0, 32) : [];
    return { ...row, id: String(row?.id ?? `bookmark-${i}`), url,
      title: String(row?.title || (url ? new URL(url).hostname : '无效书签')).slice(0, 200), path,
      destination: explicitName || (preserveFolders && path.length ? path.join(' / ') : '未分组'),
      status: !url ? 'invalid' : duplicate && duplicatePolicy === 'skip' ? 'duplicate' : 'new',
      reason: !url ? '仅支持不含账号密码的 HTTP(S) 网址' : duplicate ? duplicatePolicy === 'keep' ? '重复网址，将另外保留一份' : '重复网址，将跳过' : '可导入',
    };
  });
};
export const importIntoDraft = (state, at, workspaceId, rows, options = {}) => {
  const preview = previewBookmarkImport(state, workspaceId, rows, options);
  const accepted = preview.filter((row) => row.status === 'new');
  const ws = findWorkspace(state, workspaceId);
  const folders = new Map(ws.folders.map((folder) => [folder.name, folder.id]));
  for (const row of accepted) {
    let folderId = options.folderId || null;
    if (!folderId && options.preserveFolders !== false && row.path.length) {
      const name = row.path.join(' / ');
      if (!folders.has(name)) {
        const folder = { id: makeId('folder'), name, updatedAt: at };
        ws.folders.push(folder); folders.set(name, folder.id);
      }
      folderId = folders.get(name);
    }
    ws.apps.push({ id: makeId('app'), name: row.title, url: row.url, folderId, iconMode: 'auto', updatedAt: at });
  }
  if (accepted.length) { ws.updatedAt = at; ws.orderUpdatedAt = at; }
  return { imported: accepted.length, skipped: preview.length - accepted.length };
};
