import { invokeChrome, requestPermissions, safeWebsiteUrl } from './browserApi.js';
import { makeId } from './workspaceModel.js';

export const SESSION_KEY = 'navinocode_local_sessions';
export const SESSION_LIMIT = 20;
export const SESSION_TAB_LIMIT = 250;
export const SESSION_BYTES = 1024 * 1024;
const EVENT = 'navinocode:sessions';
const colors = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
const cleanName = (name, fallback) => String(name || fallback).trim().slice(0, 120) || fallback;
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
export const normalizeSessionTabs = (tabs, groups = {}) => {
  if (!Array.isArray(tabs)) throw new Error('会话标签页格式无效');
  const seen = new Set(); const items = []; let duplicates = 0; let excluded = 0;
  for (const tab of tabs) {
    const url = tab?.incognito ? null : safeWebsiteUrl(tab?.pendingUrl || tab?.url);
    if (!url) { excluded += 1; continue; }
    if (seen.has(url)) { duplicates += 1; continue; }
    seen.add(url);
    if (items.length >= SESSION_TAB_LIMIT) throw new Error(`每个会话最多 ${SESSION_TAB_LIMIT} 个有效标签页，请分批保存`);
    const group = groups[tab.groupId] || tab.group;
    items.push({ url, title: cleanName(tab.title, new URL(url).hostname), pinned: tab.pinned === true,
      group: group && typeof group === 'object' ? {
        id: String(group.id ?? tab.groupId ?? 'group'), title: cleanName(group.title, '未命名分组'),
        color: colors.has(group.color) ? group.color : 'grey', collapsed: group.collapsed === true,
      } : null });
  }
  return { tabs: items, duplicates, excluded };
};
export const readSessions = () => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw === null) return [];
  let value;
  try { value = JSON.parse(raw); } catch { throw new Error('本地会话数据损坏，原数据未改动'); }
  if (value?.version !== 1 || !Array.isArray(value.sessions) || value.sessions.length > SESSION_LIMIT) throw new Error('不支持的会话格式');
  const ids = new Set();
  return value.sessions.map((session) => {
    if (!session || typeof session.id !== 'string' || !session.id || ids.has(session.id) || typeof session.name !== 'string' || !Array.isArray(session.tabs)) throw new Error('会话记录无效');
    ids.add(session.id);
    const normalized = normalizeSessionTabs(session.tabs);
    if (normalized.excluded || normalized.duplicates || normalized.tabs.length !== session.tabs.length) throw new Error('会话含有无效或重复网址，原数据未改动');
    return { ...session, tabs: normalized.tabs };
  });
};
const writeSessions = (sessions) => {
  const value = { version: 1, sessions };
  if (sessions.length > SESSION_LIMIT || bytes(value) > SESSION_BYTES) throw new Error('会话存储已达上限，请先导出并删除旧会话');
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent(EVENT));
};
export const saveSession = (name, tabs) => {
  if (!String(name || '').trim()) throw new Error('请输入会话名称');
  const normalized = normalizeSessionTabs(tabs);
  if (!normalized.tabs.length) throw new Error('没有可保存的 HTTP(S) 标签页');
  const session = { id: makeId('session'), name: cleanName(name, '会话'), createdAt: new Date().toISOString(), tabs: normalized.tabs };
  writeSessions([session, ...readSessions()]);
  return session;
};
export const deleteSession = (id) => {
  const sessions = readSessions();
  if (!sessions.some((session) => session.id === id)) throw new Error('会话已不存在');
  writeSessions(sessions.filter((session) => session.id !== id));
};
export const subscribeSessions = (callback) => {
  const storage = (event) => { if (event.key === null || event.key === SESSION_KEY) callback(); };
  window.addEventListener(EVENT, callback); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage); };
};
export const captureCurrentWindow = async ({ includeGroups = true } = {}) => {
  await requestPermissions(includeGroups ? ['tabs', 'tabGroups'] : ['tabs']);
  const tabs = await invokeChrome(chrome.tabs, 'query', { currentWindow: true });
  if (tabs.some((tab) => tab.incognito)) throw new Error('不保存隐私窗口会话');
  const groups = {};
  if (includeGroups) {
    const ids = [...new Set(tabs.filter((tab) => Number.isInteger(tab.groupId) && tab.groupId >= 0).map((tab) => tab.groupId))];
    for (const id of ids) groups[id] = await invokeChrome(chrome.tabGroups, 'get', id);
  }
  return normalizeSessionTabs([...tabs].sort((a, b) => a.index - b.index), groups);
};
export const planSessionRestore = (session, openTabs = [], { selectedUrls, skipOpen = true } = {}) => {
  const normalized = normalizeSessionTabs(session?.tabs || []);
  const selected = selectedUrls ? new Set(selectedUrls) : null;
  const existing = new Set(openTabs.filter((tab) => !tab.incognito).map((tab) => safeWebsiteUrl(tab.pendingUrl || tab.url)).filter(Boolean));
  const candidates = normalized.tabs.filter((tab) => !selected || selected.has(tab.url));
  return { open: candidates.filter((tab) => !skipOpen || !existing.has(tab.url)),
    skipped: candidates.filter((tab) => skipOpen && existing.has(tab.url)), excluded: normalized.excluded };
};
export const previewSessionRestore = async (session, options = {}) => {
  await requestPermissions(['tabs']);
  const tabs = await invokeChrome(chrome.tabs, 'query', { currentWindow: true });
  if (tabs.some((tab) => tab.incognito)) throw new Error('不向隐私窗口恢复会话');
  return planSessionRestore(session, tabs, options);
};
let restoring = false;
export const restoreSession = async (session, { target = 'current', group = true, skipOpen = true, selectedUrls, signal } = {}) => {
  if (restoring) throw new Error('已有会话正在恢复');
  if (!['current', 'new'].includes(target)) throw new Error('无效的目标窗口');
  restoring = true;
  try {
    await requestPermissions(group ? ['tabs', 'tabGroups'] : ['tabs']);
    const existing = await invokeChrome(chrome.tabs, 'query', { currentWindow: true });
    if (existing.some((tab) => tab.incognito)) throw new Error('不向隐私窗口恢复会话');
    const plan = planSessionRestore(session, existing, { selectedUrls, skipOpen });
    const result = { opened: [], skipped: plan.skipped.length, failed: [], groupErrors: [], cancelled: false };
    let windowId = existing[0]?.windowId;
    const createdGroups = new Map();
    for (const entry of plan.open) {
      if (signal?.aborted) { result.cancelled = true; break; }
      try {
        let tab;
        if (target === 'new' && !result.opened.length && !Number.isInteger(result.newWindowId)) {
          const win = await invokeChrome(chrome.windows, 'create', { url: entry.url, focused: false, incognito: false });
          if (!Number.isInteger(win?.id)) throw new Error('新窗口创建失败');
          windowId = win.id; result.newWindowId = win.id;
          tab = win.tabs?.[0];
          if (!Number.isInteger(tab?.id)) throw new Error('浏览器未返回新标签页 ID');
          // The URL is already open. A pinning failure must not cause a retry
          // that opens it a second time.
          if (entry.pinned) {
            try { await invokeChrome(chrome.tabs, 'update', tab.id, { pinned: true }); }
            catch (error) { result.groupErrors.push(`固定标签页失败：${error.message}`); }
          }
        } else {
          tab = await invokeChrome(chrome.tabs, 'create', { url: entry.url, active: false, pinned: entry.pinned,
            ...(Number.isInteger(windowId) ? { windowId } : {}) });
        }
        if (!Number.isInteger(tab?.id)) throw new Error('浏览器未返回新标签页 ID');
        result.opened.push({ id: tab.id, url: entry.url });
        // Pinned tabs cannot belong to a tab group.
        if (group && !entry.pinned) {
          const metadata = entry.group || { id: '__session__', title: session.name || '恢复的会话', color: 'grey', collapsed: false };
          const key = metadata.id;
          if (!createdGroups.has(key)) createdGroups.set(key, { metadata, ids: [] });
          createdGroups.get(key).ids.push(tab.id);
        }
      } catch (error) { result.failed.push({ url: entry.url, message: error.message || '打开失败' }); }
    }
    for (const { metadata, ids } of createdGroups.values()) {
      if (signal?.aborted) { result.cancelled = true; break; }
      try {
        const id = await invokeChrome(chrome.tabs, 'group', { tabIds: ids });
        await invokeChrome(chrome.tabGroups, 'update', id, { title: metadata.title, color: metadata.color, collapsed: metadata.collapsed });
      } catch (error) { result.groupErrors.push(error.message || '标签页已打开，但分组失败'); }
    }
    return result;
  } finally { restoring = false; }
};
