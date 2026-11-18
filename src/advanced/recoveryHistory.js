import { clone, makeId, validateFullSnapshot } from './workspaceModel.js';

export const RECOVERY_HISTORY_KEY = 'navinocode_workspace_recovery_history';
const LEGACY_RECOVERY_KEY = 'navinocode_workspace_recovery';
export const HISTORY_LIMIT = 20;
export const HISTORY_BYTES = 4 * 1024 * 1024;
const EVENT = 'navinocode:recovery-history';
export const utf8Bytes = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const validateEntry = (entry) => {
  if (!entry || typeof entry.id !== 'string' || typeof entry.createdAt !== 'string' || typeof entry.reason !== 'string') throw new Error('恢复历史损坏，请先导出原始恢复数据');
  validateFullSnapshot({ advancedState: entry.state });
  return entry;
};
export const readRecoveryHistory = () => {
  const raw = localStorage.getItem(RECOVERY_HISTORY_KEY);
  if (raw !== null) {
    let value;
    try { value = JSON.parse(raw); } catch { throw new Error('恢复历史损坏，原数据未改动'); }
    if (value?.version !== 1 || !Array.isArray(value.entries)) throw new Error('不支持的恢复历史格式，原数据未改动');
    const ids = new Set();
    return value.entries.map((entry) => {
      validateEntry(entry);
      if (ids.has(entry.id)) throw new Error('恢复历史 ID 重复，原数据未改动');
      ids.add(entry.id); return entry;
    });
  }
  const legacy = localStorage.getItem(LEGACY_RECOVERY_KEY);
  if (!legacy) return [];
  let point;
  try { point = JSON.parse(legacy); } catch { throw new Error('旧恢复点损坏，原数据未改动'); }
  if (!point?.state) throw new Error('旧恢复点格式无效，原数据未改动');
  return [validateEntry({ ...point, id: 'legacy-recovery', reason: String(point.reason || '旧版恢复点'), createdAt: String(point.createdAt || '') })];
};
const notify = () => window.dispatchEvent(new CustomEvent(EVENT));
const writeEntries = (entries) => {
  const serialized = JSON.stringify({ version: 1, entries });
  if (utf8Bytes(serialized) > HISTORY_BYTES) throw new Error('恢复历史超过 4 MiB 上限，请先导出配置或减小本地图片');
  localStorage.setItem(RECOVERY_HISTORY_KEY, serialized);
  notify();
};
export const saveRecoveryRecord = (state, reason = '手动创建') => {
  validateFullSnapshot({ advancedState: state });
  const entry = { id: makeId('recovery'), reason: String(reason).slice(0, 120), createdAt: new Date().toISOString(), state: clone(state) };
  const entries = [entry, ...readRecoveryHistory()].slice(0, HISTORY_LIMIT);
  while (entries.length > 1 && utf8Bytes({ version: 1, entries }) > HISTORY_BYTES) entries.pop();
  // Retry smaller histories only for quota errors. A failed setItem leaves the
  // old record intact; a newest point is NEVER silently omitted.
  while (true) {
    try { writeEntries(entries); return entry; }
    catch (error) {
      if (error.name !== 'QuotaExceededError' || entries.length <= 1) throw error;
      entries.pop();
    }
  }
};
export const findRecoveryRecord = (id) => {
  const entries = readRecoveryHistory();
  return id ? entries.find((entry) => entry.id === id) || null : entries[0] || null;
};
export const deleteRecoveryRecord = (id) => {
  const entries = readRecoveryHistory();
  if (!entries.some((entry) => entry.id === id)) throw new Error('恢复点已不存在');
  writeEntries(entries.filter((entry) => entry.id !== id));
};
export const recoveryUsage = () => {
  const entries = readRecoveryHistory();
  return { count: entries.length, bytes: utf8Bytes({ version: 1, entries }), limit: HISTORY_LIMIT, byteLimit: HISTORY_BYTES };
};
export const subscribeRecoveryHistory = (callback) => {
  const storage = (event) => { if (event.key === null || [RECOVERY_HISTORY_KEY, LEGACY_RECOVERY_KEY].includes(event.key)) callback(); };
  window.addEventListener(EVENT, callback); window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage); };
};
