import { captureFullSnapshot, applyFullSnapshot, importFullSnapshot, validateFullSnapshot } from './storage.js';
import { mergeSnapshots } from './syncMerge.js';
import { readNativeSnapshot } from './nativeSync.js';
import { readCloudSnapshot } from '../lib/cloudSync.js';
import { cloudDiagnosticScope, observeSync, sanitizeSyncError } from './syncDiagnostics.js';
import { assertPreviewCurrent, preserveOmittedAssets, previewSignature } from './snapshotDiff.js';

const scopeFor = (backend, config, syncId) => backend === 'browser' ? 'browser' : cloudDiagnosticScope(config, undefined, syncId);
const readRemote = (backend, config, syncId) => {
  if (backend === 'browser') return readNativeSnapshot();
  if (backend !== 'supabase') throw new Error('未知同步来源');
  if (!config?.url || !config?.anonKey || !String(syncId || '').trim()) throw new Error('请先填写并保存 Supabase 配置和同步 ID');
  return readCloudSnapshot(config, undefined, syncId);
};
export const prepareSyncPreview = (backend, config, syncId) => {
  const scope = scopeFor(backend, config, syncId);
  return observeSync(scope, backend, 'preview', async () => {
    const envelope = await readRemote(backend, config, syncId);
    if (!envelope?.payload) return { found: false };
    validateFullSnapshot(envelope.payload);
    const local = captureFullSnapshot();
    const remote = preserveOmittedAssets(envelope.payload, local);
    let merged = null; let mergeError = '';
    try { merged = preserveOmittedAssets(mergeSnapshots(local, envelope.payload), local); }
    catch (error) { mergeError = sanitizeSyncError(error); }
    return { found: true, backend, scope, local, remote, merged, mergeError, revision: envelope.revision,
      rawRemote: envelope.payload, localSignature: previewSignature(local), remoteSignature: previewSignature(envelope.payload) };
  });
};
export const applySyncPreview = (preview, mode, config, syncId) => {
  if (!preview?.found || !['merge', 'replace'].includes(mode)) throw new Error('无效的同步预览');
  if (preview.scope !== scopeFor(preview.backend, config, syncId)) throw new Error('同步配置已变化，请重新预览');
  return observeSync(preview.scope, preview.backend, 'resolve', async () => {
    assertPreviewCurrent(preview.localSignature, captureFullSnapshot());
    const remote = await readRemote(preview.backend, config, syncId);
    if (!remote?.payload || previewSignature(remote.payload) !== preview.remoteSignature) throw new Error('云端在预览后已更新，请刷新预览再确认');
    assertPreviewCurrent(preview.localSignature, captureFullSnapshot());
    if (mode === 'merge') {
      if (!preview.merged) throw new Error(preview.mergeError || '不能自动合并，请检查两端数据');
      applyFullSnapshot(preview.merged);
    } else {
      // Explicit replacement must tombstone old identities to prevent them
      // returning from another device. This also writes a recovery point.
      importFullSnapshot(preview.remote);
    }
    return { payload: captureFullSnapshot(), acknowledgedPayload: remote.payload, revision: remote.revision };
  });
};
