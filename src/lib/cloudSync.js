import { createSupabaseClient, getSupabaseClientId } from "@/integrations/supabase/client";
import {
  captureFullSnapshot,
  getDeviceId,
  saveAdvancedState,
} from "@/advanced/storage";
import { mergeSnapshots, snapshotsDiffer } from "@/advanced/syncMerge";

export const DEFAULT_SYNC_TABLE = "navinocode_states";
const ENVELOPE_VERSION = 2;
const BASE_REVISION_PREFIX = "navinocode_sync_base_revision:";

const createClientOrThrow = (config) => {
  const client = createSupabaseClient(config);
  if (!client) throw new Error("缺少 Supabase URL 或 anon key");
  return client;
};

const baseRevisionKey = (clientId) => `${BASE_REVISION_PREFIX}${clientId}`;
const readBaseRevision = (clientId) => Number(localStorage.getItem(baseRevisionKey(clientId)) || 0);
const writeBaseRevision = (clientId, revision) => localStorage.setItem(baseRevisionKey(clientId), String(revision || 0));

const createEnvelope = (payload, revision) => ({
  __navinocodeSync: ENVELOPE_VERSION,
  revision,
  deviceId: getDeviceId(),
  updatedAt: new Date().toISOString(),
  payload,
});

const unwrapEnvelope = (data, updatedAt) => {
  if (data?.__navinocodeSync === ENVELOPE_VERSION && data.payload) {
    return {
      revision: Number(data.revision || 0),
      deviceId: data.deviceId || "unknown",
      updatedAt: data.updatedAt || updatedAt || null,
      payload: data.payload,
      legacy: false,
    };
  }
  return data ? {
    revision: 0,
    deviceId: "legacy",
    updatedAt: updatedAt || null,
    payload: data,
    legacy: true,
  } : null;
};

const readRemote = async (client, table, clientId) => {
  const { data, error } = await client
    .from(table)
    .select("data, updated_at")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return unwrapEnvelope(data?.data, data?.updated_at);
};

const dispatchConflict = (detail) => {
  window.dispatchEvent(new CustomEvent("navinocode:sync-conflict", { detail }));
};

const enrichPayload = (payload) => {
  const local = captureFullSnapshot();
  return mergeSnapshots(local, payload || {});
};

export const pullCloudState = async (config, table = DEFAULT_SYNC_TABLE, syncId) => {
  const client = createClientOrThrow(config);
  const clientId = syncId || getSupabaseClientId();
  const remote = await readRemote(client, table, clientId);
  if (!remote) return { payload: null, updatedAt: null, revision: 0 };

  const local = captureFullSnapshot();
  const payload = mergeSnapshots(local, remote.payload);
  const hadLocalDifferences = snapshotsDiffer(local, remote.payload);

  if (payload.advancedState) saveAdvancedState(payload.advancedState, { preserveUpdatedAt: true });
  writeBaseRevision(clientId, remote.revision);

  if (hadLocalDifferences && remote.deviceId !== getDeviceId()) {
    dispatchConflict({
      source: "supabase",
      resolution: "merged",
      remoteRevision: remote.revision,
      message: "检测到其他设备的修改，已合并本地与云端数据。",
    });
  }

  return {
    payload,
    updatedAt: remote.updatedAt,
    revision: remote.revision,
    merged: hadLocalDifferences,
  };
};

export const pushCloudState = async (
  config,
  payload,
  table = DEFAULT_SYNC_TABLE,
  syncId
) => {
  const client = createClientOrThrow(config);
  const clientId = syncId || getSupabaseClientId();
  const localPayload = enrichPayload(payload);
  const remote = await readRemote(client, table, clientId);
  const baseRevision = readBaseRevision(clientId);
  const conflict = Boolean(
    remote &&
    remote.revision > baseRevision &&
    remote.deviceId !== getDeviceId() &&
    snapshotsDiffer(remote.payload, localPayload)
  );
  const finalPayload = conflict ? mergeSnapshots(remote.payload, localPayload) : localPayload;
  const revision = Math.max(remote?.revision || 0, baseRevision) + 1;
  const envelope = createEnvelope(finalPayload, revision);

  const { error } = await client.from(table).upsert(
    {
      client_id: clientId,
      data: envelope,
      updated_at: envelope.updatedAt,
    },
    { onConflict: "client_id" }
  );
  if (error) throw error;

  writeBaseRevision(clientId, revision);
  if (finalPayload.advancedState) saveAdvancedState(finalPayload.advancedState, { preserveUpdatedAt: true });

  if (conflict) {
    dispatchConflict({
      source: "supabase",
      resolution: "merged",
      remoteRevision: remote.revision,
      revision,
      message: "云端版本已更新，上传前已自动合并两端修改。",
    });
  }

  return { revision, conflict, payload: finalPayload };
};

export const hasSupabaseConfig = (config) =>
  Boolean(config?.url && config?.anonKey);
