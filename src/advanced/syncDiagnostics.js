import { stableSnapshotString } from './syncMerge.js';

export const DIAGNOSTICS_KEY = 'navinocode_sync_diagnostics_v1';
export const DIAGNOSTICS_LIMIT = 30;
const EVENT = 'navinocode:sync-diagnostics';
let cachedRaw; let cache;
const running = new Map();
const empty = () => ({ version: 1, scopes: {} });
const isRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const cleanScope = (value) => ({
  ...value,
  events: (Array.isArray(value.events) ? value.events : []).filter(isRecord).slice(0, DIAGNOSTICS_LIMIT).map((event) => ({
    at: String(event.at || ''), direction: String(event.direction || ''), result: String(event.result || ''),
    durationMs: Number.isFinite(event.durationMs) ? event.durationMs : 0,
    revision: Number.isFinite(event.revision) ? event.revision : null, message: sanitizeSyncError(event.message || ''),
  })),
  lastError: sanitizeSyncError(value.lastError || ''),
});
const read = () => {
  let raw;
  try { raw = localStorage.getItem(DIAGNOSTICS_KEY); } catch { return cache || empty(); }
  if (cache && raw === cachedRaw) return cache;
  let parsed; try { parsed = JSON.parse(raw || 'null'); } catch { parsed = null; }
  cache = parsed?.version === 1 && isRecord(parsed.scopes) ? { version: 1, scopes: Object.fromEntries(Object.entries(parsed.scopes).filter(([, value]) => isRecord(value)).slice(0, 8).map(([key, value]) => [key, cleanScope(value)])) } : empty();
  cachedRaw = raw; return cache;
};
// Only a scope identifier is stored, never the URL, sync ID or API credential.
// This non-cryptographic name is diagnostic namespacing, not authentication.
export const cloudDiagnosticScope = (config, table = 'navinocode_states', syncId = '') => {
  const text = JSON.stringify([String(config?.url || '').trim().replace(/\/+$/, ''), table, String(syncId).trim()]);
  let a = 2166136261; let b = 2246822519;
  for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 3266489917); }
  return `supabase-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
};
export const sanitizeSyncError = (error, sensitive = []) => sensitive.filter((value) => typeof value === 'string' && value.length > 0).reduce((message, value) => message.split(value).join('[已隐藏]'), String(error?.message ?? error ?? '同步失败'))
  .replace(/https?:\/\/[^\s"'<>]+/gi, '[服务地址]')
  .replace(/\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}\b/g, '[凭据]')
  .replace(/\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+/g, '[凭据]')
  .replace(/((?:api[_-]?key|anon[_-]?key|authorization|password|token)\s*[=:]\s*)[^\s,;]+/gi, '$1[已隐藏]')
  .slice(0, 280);
const notify = () => window.dispatchEvent(new CustomEvent(EVENT));
const update = (scope, patch, event) => {
  const root = read(); const previous = root.scopes[scope] || {};
  const next = { ...previous, ...patch, updatedAt: new Date().toISOString(),
    events: event ? [event, ...(Array.isArray(previous.events) ? previous.events : [])].slice(0, DIAGNOSTICS_LIMIT) : previous.events || [] };
  const scopes = Object.fromEntries(Object.entries({ ...root.scopes, [scope]: next })
    .sort(([, a], [, b]) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 8));
  cache = { version: 1, scopes };
  try { const raw = JSON.stringify(cache); localStorage.setItem(DIAGNOSTICS_KEY, raw); cachedRaw = raw; }
  catch { next.volatile = true; } // Diagnostics must not turn a successful upload into a reported failure.
  notify();
};
export const getSyncDiagnostics = (scope) => ({ ...read().scopes[scope], running: (running.get(scope) || 0) > 0 });
export const subscribeSyncDiagnostics = (callback) => {
  const storage = (event) => { if (event.key === null || event.key === DIAGNOSTICS_KEY) callback(); };
  window.addEventListener(EVENT, callback); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage); };
};
export const snapshotFingerprint = async (snapshot) => {
  if (!globalThis.crypto?.subtle) return null; // Insecure Web origins show “unknown”, not a false clean state.
  const data = new TextEncoder().encode(stableSnapshotString(snapshot));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
export const observeSync = async (scope, backend, direction, operation, sensitive = []) => {
  const started = Date.now(); const at = new Date().toISOString();
  running.set(scope, (running.get(scope) || 0) + 1);
  update(scope, { backend, lastAttempt: at, lastDirection: direction });
  try {
    const result = await operation();
    const acknowledged = result?.acknowledgedPayload || result?.payload;
    let acknowledgedFingerprint = null;
    try { if (acknowledged) acknowledgedFingerprint = await snapshotFingerprint(acknowledged); } catch {}
    update(scope, { ...(direction === 'preview' ? { lastPreviewAt: new Date().toISOString() } : { lastSuccess: new Date().toISOString() }), lastError: '', lastResult: 'success',
      ...(direction === 'preview' ? {} : { acknowledgedFingerprint, remoteExists: result?.found !== false }),
      lastRevision: Number.isFinite(result?.revision) ? result.revision : null }, {
      at, direction, result: result?.conflict || result?.merged ? 'conflict' : 'success',
      durationMs: Math.max(0, Date.now() - started), revision: Number.isFinite(result?.revision) ? result.revision : null,
      message: result?.found === false ? '远端暂无配置' : direction === 'preview' ? '预览读取成功，本地未变' : result?.conflict || result?.merged ? '检测到差异并已合并；覆盖前保留恢复点' : '操作成功',
    });
    return result;
  } catch (error) {
    const cancelled = error?.name === 'AbortError';
    const message = cancelled ? '操作已取消' : sanitizeSyncError(error, sensitive);
    update(scope, { lastResult: cancelled ? 'cancelled' : 'error', lastError: cancelled ? '' : message },
      { at, direction, result: cancelled ? 'cancelled' : 'error', message, durationMs: Math.max(0, Date.now() - started) });
    const safe = new Error(message); safe.name = error?.name || 'Error';
    throw safe;
  } finally {
    running.set(scope, Math.max(0, (running.get(scope) || 1) - 1)); notify();
  }
};
export const setDiagnosticQuota = (scope, quota) => update(scope, { quota: {
  used: Number.isFinite(quota?.used) ? quota.used : null,
  limit: Number.isFinite(quota?.limit) ? quota.limit : null,
  measuredAt: new Date().toISOString(),
} });
export const exportSyncDiagnostics = (scope) => {
  const value = getSyncDiagnostics(scope);
  return { version: 1, backend: value.backend, lastSuccess: value.lastSuccess, lastAttempt: value.lastAttempt,
    lastError: sanitizeSyncError(value.lastError || ''), lastResult: value.lastResult, lastRevision: value.lastRevision,
    quota: value.quota, events: (value.events || []).slice(0, DIAGNOSTICS_LIMIT).map((event) => ({
      at: event.at, direction: event.direction, result: event.result, durationMs: event.durationMs, revision: event.revision,
      message: sanitizeSyncError(event.message),
    })) };
};
