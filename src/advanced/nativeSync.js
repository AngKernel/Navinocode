import {
  ADVANCED_KEYS,
  applyFullSnapshot,
  captureFullSnapshot,
  getDeviceId,
  isNativeSyncEnabled,
  setNativeSyncEnabled,
  validateFullSnapshot,
} from './storage.js';
import { mergeSnapshots, snapshotsDiffer, stableSnapshotString } from './syncMerge.js';

const META_KEY = 'navinocode_sync_meta';
const CHUNK_PREFIX = 'navinocode_sync_chunk_';
const LOCAL_REVISION_KEY = 'navinocode_native_sync_revision';
const LAST_HASH_KEY = 'navinocode_native_sync_hash';
const CHUNK_SIZE = 1800;
const MAX_SYNC_BYTES = 90000;

export const hasNativeSync = () => Boolean(globalThis.chrome?.runtime?.id && globalThis.chrome?.storage?.sync);

const invoke = (api, method, ...args) => new Promise((resolve, reject) => {
  if (!api?.[method]) return reject(new Error('当前环境不支持浏览器同步'));
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

const assertActive = (signal) => {
  if (signal?.aborted) throw new DOMException('同步已取消', 'AbortError');
};

// Serialize manual and automatic operations within this page. This is not a
// cross-device compare-and-swap; distributed conflict handling remains separate.
let syncQueue = Promise.resolve();
const enqueueSync = (operation) => {
  const result = syncQueue.then(operation);
  syncQueue = result.catch(() => {});
  return result;
};

const getLocalRevision = () => Number(localStorage.getItem(LOCAL_REVISION_KEY) || 0);
const setLocalRevision = (revision) => localStorage.setItem(LOCAL_REVISION_KEY, String(revision || 0));

const splitChunks = (text) => {
  const chunks = [];
  for (let index = 0; index < text.length; index += CHUNK_SIZE) chunks.push(text.slice(index, index + CHUNK_SIZE));
  return chunks;
};

const readNativeEnvelope = async (signal) => {
  assertActive(signal);
  if (!hasNativeSync()) return null;
  const metaResult = await invoke(globalThis.chrome.storage.sync, 'get', META_KEY);
  assertActive(signal);
  const meta = metaResult?.[META_KEY];
  if (!meta) return null;
  if (meta.version !== 1 || !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > 511) {
    throw new Error('浏览器同步元数据无效，未覆盖本地配置');
  }
  const keys = Array.from({ length: meta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`);
  const values = await invoke(globalThis.chrome.storage.sync, 'get', keys);
  assertActive(signal);
  if (keys.some((key) => typeof values?.[key] !== 'string')) {
    throw new Error('浏览器同步数据尚未完整，请稍后重试');
  }
  let envelope;
  try {
    envelope = JSON.parse(keys.map((key) => values[key]).join(''));
  } catch {
    throw new Error('浏览器同步数据损坏，请重新上传本地配置');
  }
  // Metadata and chunks can arrive independently on another device.
  if (envelope?.version !== 1 || !Number.isInteger(envelope.revision) || envelope.revision < 0
    || envelope.revision !== meta.revision || envelope.deviceId !== meta.deviceId
    || envelope.updatedAt !== meta.updatedAt) {
    throw new Error('浏览器同步版本尚未一致，请稍后重试');
  }
  validateFullSnapshot(envelope.payload);
  return envelope;
};

const writeNativeEnvelope = async (envelope, signal) => {
  assertActive(signal);
  const oldMetaResult = await invoke(globalThis.chrome.storage.sync, 'get', META_KEY);
  assertActive(signal);
  const oldCount = Number(oldMetaResult?.[META_KEY]?.chunks || 0);
  const serialized = JSON.stringify(envelope);
  const chunks = splitChunks(serialized);
  const values = {
    [META_KEY]: {
      version: 1,
      chunks: chunks.length,
      revision: envelope.revision,
      updatedAt: envelope.updatedAt,
      deviceId: envelope.deviceId,
    },
  };
  chunks.forEach((chunk, index) => { values[`${CHUNK_PREFIX}${index}`] = chunk; });
  const encoder = new TextEncoder();
  // storage.sync counts keys and JSON-encoded values, including escaped chunks.
  const byteLength = Object.entries(values).reduce((total, [key, value]) =>
    total + encoder.encode(key).length + encoder.encode(JSON.stringify(value)).length, 0);
  if (byteLength > MAX_SYNC_BYTES) {
    throw new Error('同步数据超过浏览器账户配额，请减少大型待办或自定义应用数据');
  }
  assertActive(signal);
  await invoke(globalThis.chrome.storage.sync, 'set', values);
  assertActive(signal);
  if (Number.isInteger(oldCount) && oldCount <= 511 && oldCount > chunks.length) {
    const staleKeys = Array.from({ length: oldCount - chunks.length }, (_, index) => `${CHUNK_PREFIX}${chunks.length + index}`);
    await invoke(globalThis.chrome.storage.sync, 'remove', staleKeys);
  }
};

const dispatchMerge = (message, detail = {}) => {
  window.dispatchEvent(new CustomEvent('navinocode:sync-conflict', {
    detail: { source: 'browser', resolution: 'merged', message, ...detail },
  }));
};

export const pushNativeSnapshot = ({ signal } = {}) => enqueueSync(async () => {
  assertActive(signal);
  if (!hasNativeSync()) throw new Error('请在 Edge/Chromium 扩展中使用浏览器同步');
  const remote = await readNativeEnvelope(signal);
  assertActive(signal);
  const localPayload = captureFullSnapshot({ compact: true });
  validateFullSnapshot(localPayload);
  const baseRevision = getLocalRevision();
  const conflict = Boolean(
    remote &&
    Number(remote.revision || 0) > baseRevision &&
    remote.deviceId !== getDeviceId() &&
    snapshotsDiffer(remote.payload, localPayload)
  );
  const payload = conflict ? mergeSnapshots(remote.payload, localPayload) : localPayload;
  const revision = Math.max(Number(remote?.revision || 0), baseRevision) + 1;
  const envelope = {
    version: 1,
    revision,
    deviceId: getDeviceId(),
    updatedAt: new Date().toISOString(),
    payload,
  };
  await writeNativeEnvelope(envelope, signal);
  assertActive(signal);
  setLocalRevision(revision);
  localStorage.setItem(LAST_HASH_KEY, stableSnapshotString(payload));
  if (conflict) {
    // Preserve edits made while the browser storage request was in flight.
    const current = captureFullSnapshot({ compact: true });
    applyFullSnapshot(snapshotsDiffer(current, localPayload) ? mergeSnapshots(payload, current) : payload);
    dispatchMerge('浏览器同步存在并发修改，上传前已自动合并。', { revision });
  }
  window.dispatchEvent(new CustomEvent('navinocode:native-sync-success'));
  return { revision, conflict, payload };
});

export const pullNativeSnapshot = ({ signal } = {}) => enqueueSync(async () => {
  assertActive(signal);
  if (!hasNativeSync()) throw new Error('请在 Edge/Chromium 扩展中使用浏览器同步');
  const remote = await readNativeEnvelope(signal);
  assertActive(signal);
  if (!remote?.payload) return { found: false, changed: false };
  const localPayload = captureFullSnapshot({ compact: true });
  const changed = snapshotsDiffer(localPayload, remote.payload);
  const payload = changed ? mergeSnapshots(localPayload, remote.payload) : localPayload;
  if (changed) applyFullSnapshot(payload);
  setLocalRevision(Number(remote.revision || 0));
  // Only the remote payload has been acknowledged. A merged local result may
  // still contain additions that need uploading on the next automatic pass.
  localStorage.setItem(LAST_HASH_KEY, stableSnapshotString(remote.payload));
  if (changed && remote.deviceId !== getDeviceId()) {
    dispatchMerge('已合并浏览器账户中的配置与本地修改。', { revision: remote.revision });
  }
  window.dispatchEvent(new CustomEvent('navinocode:native-sync-success'));
  return { found: true, changed, payload, revision: remote.revision };
});

export const enableNativeSync = async () => {
  if (!hasNativeSync()) throw new Error('当前环境不支持浏览器原生同步');
  const wasEnabled = isNativeSyncEnabled();
  try {
    await pullNativeSnapshot();
    const result = await pushNativeSnapshot();
    // Start the background listeners only after the initial exchange succeeds.
    setNativeSyncEnabled(true);
    return result;
  } catch (error) {
    setNativeSyncEnabled(wasEnabled);
    throw error;
  }
};

export const disableNativeSync = () => setNativeSyncEnabled(false);

const startNativeSync = () => {
  const controller = new AbortController();
  let changeTimer = null;
  let busy = false;
  let pendingPull = false;
  const active = () => !controller.signal.aborted && isNativeSyncEnabled();

  const run = async (direction) => {
    if (!active()) return;
    if (busy) {
      if (direction === 'pull') pendingPull = true;
      return;
    }
    if (direction === 'push' && document.visibilityState === 'hidden') return;
    busy = true;
    try {
      let result;
      if (direction === 'pull') {
        result = await pullNativeSnapshot({ signal: controller.signal });
      } else {
        const snapshot = captureFullSnapshot({ compact: true });
        if (stableSnapshotString(snapshot) !== localStorage.getItem(LAST_HASH_KEY)) {
          result = await pushNativeSnapshot({ signal: controller.signal });
        }
      }
      if (active() && result?.changed) {
        window.dispatchEvent(new CustomEvent('navinocode:native-sync-applied'));
      }
    } catch (error) {
      if (active() && error.name !== 'AbortError') {
        window.dispatchEvent(new CustomEvent('navinocode:native-sync-error', { detail: { message: error.message } }));
      }
    } finally {
      busy = false;
      if (active() && pendingPull) {
        pendingPull = false;
        void run('pull');
      }
    }
  };

  const timer = window.setInterval(() => { void run('push'); }, 15000);
  const onStorageChanged = (changes, areaName) => {
    if (!active() || areaName !== 'sync'
      || !Object.keys(changes).some((key) => key === META_KEY || key.startsWith(CHUNK_PREFIX))) return;
    window.clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => { void run('pull'); }, 400);
  };
  globalThis.chrome.storage.onChanged?.addListener(onStorageChanged);
  void run('pull');

  return () => {
    controller.abort();
    pendingPull = false;
    window.clearInterval(timer);
    window.clearTimeout(changeTimer);
    globalThis.chrome.storage.onChanged?.removeListener(onStorageChanged);
  };
};

export const initializeNativeSync = () => {
  let enabled = null;
  let stop = () => {};
  const refresh = () => {
    const next = hasNativeSync() && isNativeSyncEnabled();
    if (next === enabled) return;
    stop();
    enabled = next;
    stop = next ? startNativeSync() : () => {};
  };
  const onPreferenceChanged = (event) => {
    if (event.key === null || event.key === ADVANCED_KEYS.NATIVE_SYNC_ENABLED_KEY) refresh();
  };
  window.addEventListener('navinocode:native-sync-setting', refresh);
  window.addEventListener('storage', onPreferenceChanged);
  refresh();
  return () => {
    stop();
    window.removeEventListener('navinocode:native-sync-setting', refresh);
    window.removeEventListener('storage', onPreferenceChanged);
  };
};
