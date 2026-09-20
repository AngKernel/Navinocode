import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useWorkspaceStore } from './useWorkspaceStore';
import { captureFullSnapshot, isNativeSyncEnabled } from './storage.js';
import { disableNativeSync, enableNativeSync, getNativeSyncUsage, hasNativeSync, pushNativeSnapshot } from './nativeSync.js';
import { pushCloudState } from '../lib/cloudSync.js';
import { cloudDiagnosticScope, exportSyncDiagnostics, getSyncDiagnostics, sanitizeSyncError, setDiagnosticQuota, snapshotFingerprint, subscribeSyncDiagnostics } from './syncDiagnostics.js';
import { prepareSyncPreview, applySyncPreview } from './syncPreview.js';
import { previewSignature } from './snapshotDiff.js';
import { downloadJSON, formatBytes, snapshotFromState } from './dataUiUtils.js';
import SnapshotDiffView from './SnapshotDiffView';

const resultNames = { success: '成功', error: '失败', conflict: '差异合并', cancelled: '已取消' };
const directionNames = { push: '上传', pull: '下载', preview: '差异预览', resolve: '应用预览' };
const SyncDiagnosticsPanel = ({ backend, config, syncId = '', cloudAutoEnabled = false, onCloudAutoChange }) => {
  const workspaceState = useWorkspaceStore();
  const browser = backend === 'browser';
  const scope = browser ? 'browser' : cloudDiagnosticScope(config, undefined, syncId);
  const supported = browser ? hasNativeSync() : Boolean(config?.url && config?.anonKey && syncId.trim());
  const [info, setInfo] = useState(() => getSyncDiagnostics(scope));
  const [nativeEnabled, setNativeEnabled] = useState(() => isNativeSyncEnabled());
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [fingerprint, setFingerprint] = useState(null); const [preview, setPreview] = useState(null);
  const [mode, setMode] = useState('merge'); const [confirmed, setConfirmed] = useState(false);
  const [quotaError, setQuotaError] = useState('');
  const automatic = browser ? nativeEnabled : cloudAutoEnabled;
  const local = useMemo(() => captureFullSnapshot({ compact: browser }), [workspaceState, browser]);
  const payloadBytes = useMemo(() => new TextEncoder().encode(JSON.stringify(local)).length, [local]);
  useEffect(() => {
    const refresh = () => setInfo(getSyncDiagnostics(scope)); refresh();
    return subscribeSyncDiagnostics(refresh);
  }, [scope]);
  useEffect(() => {
    let cancelled = false; setFingerprint(null);
    snapshotFingerprint(local).then((value) => { if (!cancelled) setFingerprint(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [local]);
  useEffect(() => {
    const refresh = () => setNativeEnabled(isNativeSyncEnabled());
    window.addEventListener('navinocode:native-sync-setting', refresh); window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('navinocode:native-sync-setting', refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const refreshQuota = async () => {
    try { setDiagnosticQuota(scope, await getNativeSyncUsage()); setQuotaError(''); }
    catch (error) { setQuotaError(sanitizeSyncError(error)); }
  };
  useEffect(() => { if (browser && supported) void refreshQuota(); }, [browser, supported, scope, info.lastSuccess]);
  const run = async (operation) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { return await operation(); }
    catch (error) { toast.error(sanitizeSyncError(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  const pause = () => {
    try { if (browser) disableNativeSync(); else onCloudAutoChange?.(false); return true; }
    catch (error) { toast.error(sanitizeSyncError(error)); return false; }
  };
  const openPreview = () => {
    if (!pause()) return;
    return run(async () => {
      const value = await prepareSyncPreview(backend, config, syncId.trim());
      if (!value.found) { toast('远端暂无配置，可以先上传本地数据'); return; }
      setMode(value.merged ? 'merge' : 'replace'); setConfirmed(false); setPreview(value);
    });
  };
  const upload = () => run(async () => {
    if (browser) await pushNativeSnapshot(); else await pushCloudState(config, undefined, undefined, syncId.trim());
    toast('上传完成');
  });
  const toggle = () => {
    if (automatic) { pause(); return; }
    return run(async () => {
      if (browser) await enableNativeSync(); else onCloudAutoChange?.(true);
      toast('自动同步已开启');
    });
  };
  const stale = preview && preview.localSignature !== previewSignature(snapshotFromState(workspaceState));
  let pending = '尚未核对远端版本';
  if (info.remoteExists === false) pending = '远端暂无配置';
  else if (info.acknowledgedFingerprint && fingerprint) pending = info.acknowledgedFingerprint === fingerprint
    ? '与最近确认的远端版本一致（非实时探测）' : '有本地变更待上传';
  else if (info.acknowledgedFingerprint && !fingerprint) pending = '正在计算本地校验值；非安全 Web 环境可能不支持';
  return <section className="space-y-3 rounded-2xl border p-4" aria-label={`${browser ? '浏览器' : 'Supabase'}同步诊断`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{browser ? '浏览器账户同步' : 'Supabase 同步'}诊断</h3><span className="text-xs">{info.running ? '操作中' : automatic ? '自动同步已开启' : '自动同步已暂停'}</span></div>
    {!supported && <p className="text-sm text-muted-foreground">{browser ? '浏览器账户同步仅支持扩展模式。' : '请先保存 Supabase URL、anon key 和同步 ID。'}</p>}
    <p role="status" className="text-sm">{pending}</p>
    <p className="text-xs text-muted-foreground">最近成功同步：{info.lastSuccess ? new Date(info.lastSuccess).toLocaleString() : '暂无'} · 最近版本：{info.lastRevision ?? '未知'}</p>
    {info.lastError && <div role="alert" className="rounded-xl bg-muted p-3 text-sm"><p>{info.lastError}</p><p className="mt-1 text-xs">检查网络、授权、连接配置或配额后重试；当前配置可先导出备份。</p></div>}
    {info.volatile && <p role="alert" className="text-xs">诊断记录未能写入本地空间，当前页面仍保留操作结果。</p>}
    <p className="text-xs">当前{browser ? '轻量' : '完整'}快照：{formatBytes(payloadBytes)}{!browser && '；服务端剩余配额请在 Supabase 项目中查看。'}</p>
    {browser && supported && <div className="space-y-1 text-xs">
      <p>浏览器同步空间：{formatBytes(info.quota?.used)} / {formatBytes(info.quota?.limit)} {info.quota?.measuredAt && `（${new Date(info.quota.measuredAt).toLocaleTimeString()} 测量）`}</p>
      {Number.isFinite(info.quota?.used) && info.quota?.limit > 0 && <progress className="w-full" value={info.quota.used} max={info.quota.limit} aria-label="浏览器同步配额使用量" />}
      {quotaError && <p>{quotaError}</p>}<Button type="button" size="sm" variant="ghost" onClick={refreshQuota}>刷新用量</Button>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={!supported || (!automatic && (busy || info.running))} onClick={toggle}>{automatic ? '暂停自动同步' : '启用自动同步'}</Button>
      <Button type="button" size="sm" disabled={!supported || busy || info.running} onClick={upload}>立即上传</Button>
      <Button type="button" size="sm" variant="outline" disabled={!supported || busy || info.running} onClick={openPreview}>预览远端差异</Button>
      {info.lastResult === 'error' && <Button type="button" size="sm" variant="outline" disabled={!supported || busy || info.running} onClick={info.lastDirection === 'push' ? upload : openPreview}>重试失败操作</Button>}
      <Button type="button" size="sm" variant="ghost" onClick={() => run(() => downloadJSON({ version: 2, exportedAt: new Date().toISOString(), data: captureFullSnapshot() }, 'navinocode-local-backup.json'))}>导出本地备份</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => run(() => downloadJSON(exportSyncDiagnostics(scope), `navinocode-${backend}-diagnostics.json`))}>导出诊断</Button>
    </div>
    <p className="text-xs text-muted-foreground">预览会暂停此后端的自动同步，关闭预览后需手动恢复。暂停不能撤回已经提交的请求。诊断仅保留本机最近 30 次操作，不记录 API 密钥或完整网址。</p>
    <details><summary className="cursor-pointer text-sm">操作历史（{info.events?.length || 0}）</summary><div className="mt-2 max-h-44 overflow-y-auto text-xs">
      {(info.events || []).map((event, i) => <p key={`${event.at}-${i}`} className="break-all border-b py-2">{new Date(event.at).toLocaleString()} · {directionNames[event.direction] || event.direction} · {resultNames[event.result] || event.result} · {event.message}</p>)}
    </div></details>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !busy) setPreview(null); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogTitle>同步差异预览</DialogTitle><DialogDescription>先检查应用到本地后的变化；确认前会重新核对两端是否变化。此操作不会上传远端，覆盖前会保存恢复点。</DialogDescription>
        <label className="space-y-1 text-sm"><span>应用方式</span><select aria-label="同步冲突处理方式" className="block w-full rounded-xl border bg-background p-2" value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value); setConfirmed(false); }}>
          <option value="merge" disabled={!preview?.merged}>合并两端数据</option><option value="replace">使用远端替换全部本地工作区</option>
        </select></label>
        {preview?.mergeError && <p role="alert" className="text-sm">自动合并不可用：{preview.mergeError}</p>}
        {preview && <SnapshotDiffView before={preview.local} after={mode === 'merge' ? preview.merged || preview.remote : preview.remote} />}
        {stale && <p role="alert" className="text-sm">本地配置已变化，请刷新预览。</p>}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />我已检查差异，确认应用到本地（替换会重新生成实体 ID）</label>
        <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(null)}>取消并保留本地</Button><Button type="button" variant="outline" disabled={busy} onClick={openPreview}>刷新预览</Button>
          <Button type="button" variant={mode === 'replace' ? 'destructive' : 'default'} disabled={!confirmed || stale || busy} onClick={() => run(async () => {
            await applySyncPreview(preview, mode, config, syncId.trim()); setPreview(null); toast('已应用到本地；自动同步仍暂停，可检查后再上传');
          })}>确认应用</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
};
export default SyncDiagnosticsPanel;
