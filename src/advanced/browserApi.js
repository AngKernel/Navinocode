export const extensionAvailable = () => Boolean(globalThis.chrome?.runtime?.id);
export const invokeChrome = (api, method, ...args) => new Promise((resolve, reject) => {
  if (!api || typeof api[method] !== 'function') { reject(new Error('当前环境不支持此浏览器功能，请使用扩展版')); return; }
  try {
    api[method](...args, (value) => {
      const error = globalThis.chrome?.runtime?.lastError;
      if (error) reject(new Error(error.message)); else resolve(value);
    });
  } catch (error) { reject(error); }
});
// Call from the click handler, before any unrelated await, to retain user activation.
export const requestPermissions = async (permissions) => {
  if (!extensionAvailable()) throw new Error('此操作仅支持 Edge/Chromium 扩展');
  const granted = await invokeChrome(globalThis.chrome.permissions, 'request', { permissions });
  if (!granted) throw new Error('未授予所需权限，没有读取或修改浏览器数据');
};
export const safeWebsiteUrl = (value) => {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
};
