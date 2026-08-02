const OPTIONAL_PERMISSIONS = ['bookmarks', 'history', 'tabs', 'topSites'];

export const isExtensionRuntime = () => Boolean(globalThis.chrome?.runtime?.id);

const invoke = (api, method, ...args) => new Promise((resolve, reject) => {
  if (!api?.[method]) return resolve(null);
  try {
    api[method](...args, (result) => {
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  } catch (error) {
    reject(error);
  }
});

const hasPermission = async (permission) => {
  if (!isExtensionRuntime() || !globalThis.chrome?.permissions) return false;
  try {
    return Boolean(await invoke(globalThis.chrome.permissions, 'contains', { permissions: [permission] }));
  } catch {
    return false;
  }
};

export const getBrowserPermissionState = async () => {
  const entries = await Promise.all(OPTIONAL_PERMISSIONS.map(async (permission) => [permission, await hasPermission(permission)]));
  return Object.fromEntries(entries);
};

export const requestBrowserSearchPermissions = async () => {
  if (!isExtensionRuntime() || !globalThis.chrome?.permissions) return false;
  try {
    return Boolean(await invoke(globalThis.chrome.permissions, 'request', { permissions: OPTIONAL_PERMISSIONS }));
  } catch {
    return false;
  }
};

const normalizeUrlResult = (source, item, index) => ({
  id: `${source}-${item.id ?? item.url ?? index}`,
  type: source,
  title: item.title || item.url || '未命名页面',
  subtitle: item.url || source,
  url: item.url || '',
  tabId: item.tabId,
  windowId: item.windowId,
});

const matches = (item, query) => `${item.title || ''} ${item.url || ''}`.toLowerCase().includes(query.toLowerCase());

export const openBrowserResult = async (item) => {
  if (item.type === 'tab' && Number.isInteger(item.tabId) && globalThis.chrome?.tabs) {
    await invoke(globalThis.chrome.tabs, 'update', item.tabId, { active: true });
    if (Number.isInteger(item.windowId) && globalThis.chrome?.windows) {
      await invoke(globalThis.chrome.windows, 'update', item.windowId, { focused: true });
    }
    return;
  }
  if (item.url) window.open(item.url, '_blank', 'noopener,noreferrer');
};

export const searchBrowserData = async (rawQuery) => {
  const query = String(rawQuery || '').trim();
  if (!query || !isExtensionRuntime()) return [];
  const permissions = await getBrowserPermissionState();
  const tasks = [];

  if (permissions.tabs && globalThis.chrome?.tabs) {
    tasks.push(invoke(globalThis.chrome.tabs, 'query', {}).then((tabs) =>
      (tabs || []).filter((tab) => tab.url && matches(tab, query)).slice(0, 6).map((tab, index) => normalizeUrlResult('tab', {
        ...tab,
        tabId: tab.id,
        windowId: tab.windowId,
      }, index))
    ).catch(() => []));
  }

  if (permissions.bookmarks && globalThis.chrome?.bookmarks) {
    tasks.push(invoke(globalThis.chrome.bookmarks, 'search', query).then((items) =>
      (items || []).filter((item) => item.url).slice(0, 6).map((item, index) => normalizeUrlResult('bookmark', item, index))
    ).catch(() => []));
  }

  if (permissions.history && globalThis.chrome?.history) {
    tasks.push(invoke(globalThis.chrome.history, 'search', {
      text: query,
      startTime: 0,
      maxResults: 8,
    }).then((items) => (items || []).map((item, index) => normalizeUrlResult('history', item, index))).catch(() => []));
  }

  if (permissions.topSites && globalThis.chrome?.topSites) {
    tasks.push(invoke(globalThis.chrome.topSites, 'get').then((items) =>
      (items || []).filter((item) => matches(item, query)).slice(0, 6).map((item, index) => normalizeUrlResult('topSite', item, index))
    ).catch(() => []));
  }

  const groups = await Promise.all(tasks);
  const seen = new Set();
  return groups.flat().filter((item) => {
    const key = `${item.type}:${item.tabId || item.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
};

export const browserPermissionLabels = {
  bookmarks: '书签',
  history: '历史记录',
  tabs: '当前标签页',
  topSites: '常用网站',
};
