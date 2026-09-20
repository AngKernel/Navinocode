import { createSupabaseClient, getSupabaseClientId } from "@/integrations/supabase/client";
import { captureFullSnapshot, getDeviceId, applyFullSnapshot, validateFullSnapshot } from "@/advanced/storage";
import { mergeSnapshots, snapshotsDiffer } from "@/advanced/syncMerge";
import { cloudDiagnosticScope, observeSync, sanitizeSyncError } from "@/advanced/syncDiagnostics";

export const DEFAULT_SYNC_TABLE = "navinocode_states";
const ENVELOPE_VERSION = 2;
const BASE_REVISION_PREFIX = "navinocode_sync_base_revision:";
let queue = Promise.resolve();
const enqueue = (operation) => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
const createClientOrThrow = (config) => {
  const client = createSupabaseClient(config);
  if (!client) throw new Error("缺少 Supabase URL 或 anon key");
  return client;
};
const revisionScope = (config, table, id) => JSON.stringify([config.url, table, id]);
const readBaseRevision = (scope) => {
  const value = Number(localStorage.getItem(`${BASE_REVISION_PREFIX}${scope}`) || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};
const writeBaseRevision = (scope, revision) => localStorage.setItem(`${BASE_REVISION_PREFIX}${scope}`, String(revision));
const assertActive = (signal) => { if (signal?.aborted) throw new DOMException('同步已取消', 'AbortError'); };
const unwrapEnvelope = (data, updatedAt) => {
  if (!data) return null;
  if (data.__navinocodeSync !== undefined) {
    if (data.__navinocodeSync !== ENVELOPE_VERSION || !data.payload || !Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('云端同步版本或元数据无效，未覆盖本地配置');
    return { revision: data.revision, deviceId: data.deviceId || 'unknown', updatedAt: data.updatedAt || updatedAt || null, payload: data.payload };
  }
  return { revision: 0, deviceId: 'legacy', updatedAt: updatedAt || null, payload: data };
};
const readRemote = async (client, table, clientId, signal) => {
  assertActive(signal);
  let query = client.from(table).select('data, updated_at').eq('client_id', clientId);
  if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  assertActive(signal);
  if (error) throw error;
  const remote = unwrapEnvelope(data?.data, data?.updated_at);
  if (remote) validateFullSnapshot(remote.payload);
  return remote;
};
const dispatchConflict = (detail) => window.dispatchEvent(new CustomEvent('navinocode:sync-conflict', { detail }));
export const readCloudSnapshot = (config, table = DEFAULT_SYNC_TABLE, syncId, { signal } = {}) => enqueue(async () => {
  try { return await readRemote(createClientOrThrow(config), table, String(syncId || getSupabaseClientId()).trim(), signal); }
  catch (error) { const safe = new Error(sanitizeSyncError(error, [config?.anonKey, syncId])); safe.name = error.name || 'Error'; throw safe; }
});

export const pullCloudState = (config, table = DEFAULT_SYNC_TABLE, syncId, { signal } = {}) => {
  const id = String(syncId || getSupabaseClientId()).trim(); const scope = cloudDiagnosticScope(config, table, id);
  return enqueue(() => observeSync(scope, 'supabase', 'pull', async () => {
    const remote = await readRemote(createClientOrThrow(config), table, id, signal);
    if (!remote) return { found: false, payload: null, updatedAt: null, revision: 0 };
    const local = captureFullSnapshot(); const payload = mergeSnapshots(local, remote.payload);
    const merged = snapshotsDiffer(local, remote.payload);
    assertActive(signal);
    // Applying and acknowledging are part of one operation: a failed recovery
    // backup or store write must not be reported as a successful download.
    applyFullSnapshot(payload);
    writeBaseRevision(revisionScope(config, table, id), remote.revision);
    if (merged && remote.deviceId !== getDeviceId()) dispatchConflict({ source: 'supabase', resolution: 'merged', remoteRevision: remote.revision,
      message: '已合并本地与云端差异，覆盖前的数据保留在恢复历史中。' });
    return { found: true, payload, acknowledgedPayload: remote.payload, updatedAt: remote.updatedAt, revision: remote.revision, merged };
  }, [config?.anonKey, id]));
};
export const pushCloudState = (config, _payload, table = DEFAULT_SYNC_TABLE, syncId, { signal } = {}) => {
  const id = String(syncId || getSupabaseClientId()).trim(); const scope = cloudDiagnosticScope(config, table, id);
  return enqueue(() => observeSync(scope, 'supabase', 'push', async () => {
    assertActive(signal);
    const client = createClientOrThrow(config);
    const remote = await readRemote(client, table, id, signal);
    const localPayload = captureFullSnapshot();
    const revisionKey = revisionScope(config, table, id); const base = readBaseRevision(revisionKey);
    const conflict = Boolean(remote && (remote.revision > base || base === 0) && snapshotsDiffer(remote.payload, localPayload));
    const payload = conflict ? mergeSnapshots(remote.payload, localPayload) : localPayload;
    const revision = Math.max(remote?.revision || 0, base) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('同步版本号超出范围');
    const envelope = { __navinocodeSync: ENVELOPE_VERSION, revision, deviceId: getDeviceId(), updatedAt: new Date().toISOString(), payload };
    assertActive(signal);
    let query = client.from(table).upsert({ client_id: id, data: envelope, updated_at: envelope.updatedAt }, { onConflict: 'client_id' });
    if (signal && typeof query.abortSignal === 'function') query = query.abortSignal(signal);
    const { error } = await query;
    if (error) throw error;
    // A submitted server write cannot be retracted by pausing auto-sync.
    assertActive(signal);
    if (conflict) {
      const current = captureFullSnapshot();
      applyFullSnapshot(snapshotsDiffer(current, localPayload) ? mergeSnapshots(payload, current) : payload);
    }
    writeBaseRevision(revisionKey, revision);
    if (conflict) dispatchConflict({ source: 'supabase', resolution: 'merged', remoteRevision: remote.revision, revision,
      message: '云端已更新，上传前合并了两端数据；可在恢复历史检查本地变化。' });
    return { revision, conflict, payload };
  }, [config?.anonKey, id]));
};
export const hasSupabaseConfig = (config) => Boolean(config?.url && config?.anonKey);
