import {
  applyFullSnapshot,
  captureFullSnapshot,
  getDeviceId,
  isNativeSyncEnabled,
  setNativeSyncEnabled,
} from './storage';
import { mergeSnapshots, snapshotsDiffer, stableSnapshotString } from './syncMerge';

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

const getLocalRevision = () => Number(localStorage.getItem(LOCAL_REVISION_KEY) || 0);
const setLocalRevision = (revision) => localStorage.setItem(LOCAL_REVISION_KEY, String(revision || 0));

const splitChunks = (text) => {
  const chunks = [];
  for (let index = 0; index < text.length; index += CHUNK_SIZE) chunks.push(text.slice(index, index + CHUNK_SIZE));
  return chunks;
};

const readNativeEnvelope = async () => {
  if (!hasNativeSync()) return null;
  const metaResult = await invoke(globalThis.chrome.storage.sync, 'get', META_KEY);
  const meta = metaResult?.[META_KEY];
  if (!meta?.chunks) return null;
  const keys = Array.from({ length: meta.chunks }, (_, index) => `${CHUNK_PREFIX}${index}`);
  const values = await invoke(globalThis.chrome.storage.sync, 'get', keys);
  const serialized = keys.map((key) => values?.[key] || '').join('');
  if (!serialized) return null;
  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error('浏览器同步数据损坏，请重新上传本地配置');
  }
};

const writeNativeEnvelope = async (envelope) => {
  const oldMetaResult = await invoke(globalThis.chrome.storage.sync, 'get', META_KEY);
  const oldCount = Number(oldMetaResult?.[META_KEY]?.chunks || 0);
  const serialized = JSON.stringify(envelope);
  const byteLength = new TextEncoder().encode(serialized).length;
  if (byteLength > MAX_SYNC_BYTES) {
    throw new Error('同步数据超过浏览器账户配额，请减少大型待办或自定义应用数据');
  }
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
  await invoke(globalThis.chrome.storage.sync, 'set', values);
  if (oldCount > chunks.length) {
    const staleKeys = Array.from({ length: oldCount - chunks.length }, (_, index) => `${CHUNK_PREFIX}${chunks.length + index}`);
    await invoke(globalThis.chrome.storage.sync, 'remove', staleKeys);
  }
};

const dispatchMerge = (message, detail = {}) => {
  window.dispatchEvent(new CustomEvent('navinocode:sync-conflict', {
    detail: { source: 'browser', resolution: 'merged', message, ...detail },
  }));
};

export const pushNativeSnapshot = async () => {
  if (!hasNativeSync()) throw new Error('请在 Edge/Chromium 扩展中使用浏览器同步');
  const localPayload = captureFullSnapshot({ compact: true });
  const remote = await readNativeEnvelope();
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
  await writeNativeEnvelope(envelope);
  setLocalRevision(revision);
  localStorage.setItem(LAST_HASH_KEY, stableSnapshotString(payload));
  if (conflict) {
    applyFullSnapshot(payload);
    dispatchMerge('浏览器同步存在并发修改，上传前已自动合并。', { revision });
  }
  return { revision, conflict, payload };
};

export const pullNativeSnapshot = async () => {
  if (!hasNativeSync()) throw new Error('请在 Edge/Chromium 扩展中使用浏览器同步');
  const remote = await readNativeEnvelope();
  if (!remote?.payload) return { found: false, changed: false };
  const localPayload = captureFullSnapshot({ compact: true });
  const changed = snapshotsDiffer(localPayload, remote.payload);
  const payload = changed ? mergeSnapshots(localPayload, remote.payload) : localPayload;
  if (changed) applyFullSnapshot(payload);
  setLocalRevision(Number(remote.revision || 0));
  localStorage.setItem(LAST_HASH_KEY, stableSnapshotString(payload));
  if (changed && remote.deviceId !== getDeviceId()) {
    dispatchMerge('已合并浏览器账户中的配置与本地修改。', { revision: remote.revision });
  }
  return { found: true, changed, payload, revision: remote.revision };
};

export const enableNativeSync = async () => {
  if (!hasNativeSync()) throw new Error('当前环境不支持浏览器原生同步');
  setNativeSyncEnabled(true);
  const remote = await readNativeEnvelope();
  if (remote?.payload) {
    await pullNativeSnapshot();
    return pushNativeSnapshot();
  }
  return pushNativeSnapshot();
};

export const disableNativeSync = () => setNativeSyncEnabled(false);

export const initializeNativeSync = () => {
  if (!hasNativeSync() || !isNativeSyncEnabled()) return () => {};
  let stopped = false;
  let timer = null;
  let changeTimer = null;

  pullNativeSnapshot().then((result) => {
    if (!stopped && result.changed) {
      window.dispatchEvent(new CustomEvent('navinocode:native-sync-applied'));
    }
  }).catch(() => {});

  const checkAndPush = async () => {
    if (stopped || document.visibilityState === 'hidden') return;
    const snapshot = captureFullSnapshot({ compact: true });
    const hash = stableSnapshotString(snapshot);
    if (hash === localStorage.getItem(LAST_HASH_KEY)) return;
    try {
      await pushNativeSnapshot();
    } catch {}
  };
  timer = window.setInterval(checkAndPush, 15000);

  const onStorageChanged = (changes, areaName) => {
    if (areaName !== 'sync' || !changes[META_KEY]) return;
    clearTimeout(changeTimer);
    changeTimer = window.setTimeout(() => {
      pullNativeSnapshot().then((result) => {
        if (result.changed) window.dispatchEvent(new CustomEvent('navinocode:native-sync-applied'));
      }).catch(() => {});
    }, 400);
  };
  globalThis.chrome.storage.onChanged?.addListener(onStorageChanged);

  return () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(changeTimer);
    globalThis.chrome.storage.onChanged?.removeListener(onStorageChanged);
  };
};
