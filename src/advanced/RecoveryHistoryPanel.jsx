import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { captureFullSnapshot, restoreRecoveryPoint, saveRecoveryPoint } from './storage.js';
import { deleteRecoveryRecord, readRecoveryHistory, recoveryUsage, subscribeRecoveryHistory, RECOVERY_HISTORY_KEY } from './recoveryHistory.js';
import { previewSignature } from './snapshotDiff.js';
import { downloadJSON, downloadText, formatBytes, snapshotFromState } from './dataUiUtils.js';
import SnapshotDiffView from './SnapshotDiffView';

const RecoveryHistoryPanel = () => {
  const [entries, setEntries] = useState([]); const [usage, setUsage] = useState(null); const [error, setError] = useState('');
  const [note, setNote] = useState(''); const [preview, setPreview] = useState(null); const [confirmed, setConfirmed] = useState(false);
  const [deleting, setDeleting] = useState(null);
  useEffect(() => {
    const refresh = () => { try { setEntries(readRecoveryHistory()); setUsage(recoveryUsage()); setError(''); } catch (e) { setError(e.message); } };
    refresh(); return subscribeRecoveryHistory(refresh);
  }, []);
  const act = (fn) => { try { return fn(); } catch (e) { toast.error(e.message); return false; } };
  const openPreview = (entry) => act(() => {
    const before = captureFullSnapshot(); setConfirmed(false);
    setPreview({ entry, before, after: snapshotFromState(entry.state), signature: previewSignature(before) });
  });
  return <section className="space-y-3 rounded-2xl border p-4" aria-label="工作区恢复历史">
    <h3 className="font-semibold">工作区恢复历史</h3>
    <p className="text-xs text-muted-foreground">导入、同步覆盖和批量整理前自动保存；最多 20 个、合计 4 MiB，达到上限时淘汰最旧记录。本地保存，不含浏览器会话或账户凭据。</p>
    {usage && <p className="text-xs">已保存 {usage.count} / {usage.limit} 个 · {formatBytes(usage.bytes)} / {formatBytes(usage.byteLimit)}</p>}
    {error && <div role="alert" className="space-y-2 text-sm">
      <p>{error}</p><Button type="button" size="sm" variant="outline" onClick={() => act(() => downloadText(localStorage.getItem(RECOVERY_HISTORY_KEY) || localStorage.getItem('navinocode_workspace_recovery') || '', 'navinocode-recovery-raw.json'))}>导出原始历史数据</Button>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Input aria-label="恢复点备注" placeholder="备注（可选）" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} className="min-w-0 flex-1" />
      <Button type="button" variant="outline" onClick={() => act(() => { saveRecoveryPoint(note.trim() || '手动创建'); setNote(''); toast('恢复点已保存'); })}>创建恢复点</Button>
    </div>
    {!entries.length && !error && <p className="text-sm text-muted-foreground">暂无恢复点。</p>}
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {entries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/30 p-3">
        <div className="min-w-0 flex-1"><p className="break-all text-sm font-medium">{entry.reason}</p><p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()} · {entry.state.workspaces.length} 个工作区</p></div>
        <Button type="button" size="sm" variant="outline" onClick={() => openPreview(entry)}>预览恢复</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => act(() => downloadJSON({ version: 2, exportedAt: new Date().toISOString(), data: snapshotFromState(entry.state) }, `navinocode-recovery-${entry.id}.json`))}>导出</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setDeleting(entry)}>删除</Button>
      </div>)}
    </div>
    <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-2xl">
        <DialogTitle>恢复前差异预览</DialogTitle>
        <DialogDescription>恢复将替换全部工作区并为恢复实体分配新 ID；当前数据会先保存成新的恢复点。</DialogDescription>
        {preview && <SnapshotDiffView before={preview.before} after={preview.after} />}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />我已检查差异，确认替换当前工作区</label>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setPreview(null)}>取消</Button>
          <Button type="button" disabled={!confirmed} onClick={() => act(() => {
            restoreRecoveryPoint(preview.entry.id, { expectedSignature: preview.signature });
            setPreview(null); toast('已恢复，恢复前数据仍在历史中');
          })}>确认恢复此版本</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
      <DialogContent className="max-w-md"><DialogTitle>删除这个恢复点？</DialogTitle><DialogDescription>只删除这一份历史记录，不修改当前工作区。删除后不能恢复此记录。</DialogDescription>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setDeleting(null)}>取消</Button><Button type="button" variant="destructive" onClick={() => act(() => { deleteRecoveryRecord(deleting.id); setDeleting(null); })}>确认删除恢复点</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
};
export default RecoveryHistoryPanel;
