import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { browserPermissionLabels, getBrowserPermissionState, isExtensionRuntime, requestBrowserSearchPermissions } from './browserData';
import SyncDiagnosticsPanel from './SyncDiagnosticsPanel';
import RecoveryHistoryPanel from './RecoveryHistoryPanel';

const SyncControls = ({ cloudConfig, syncId = '', autoSyncEnabled = false, onAutoSyncChange }) => {
  const [permissions, setPermissions] = useState({});
  useEffect(() => { let active = true; getBrowserPermissionState().then((value) => { if (active) setPermissions(value); }).catch(() => {}); return () => { active = false; }; }, []);
  const enableSearch = async () => {
    try {
      const granted = await requestBrowserSearchPermissions(); setPermissions(await getBrowserPermissionState());
      toast(granted ? '浏览器搜索权限已更新' : '未授予浏览器搜索权限');
    } catch (error) { toast.error(error.message || '授权失败'); }
  };
  return <div className="space-y-5">
    <SyncDiagnosticsPanel backend="browser" />
    <SyncDiagnosticsPanel backend="supabase" config={cloudConfig} syncId={syncId} cloudAutoEnabled={autoSyncEnabled} onCloudAutoChange={onAutoSyncChange} />
    <RecoveryHistoryPanel />
    <section className="space-y-2 rounded-2xl border p-4"><h3 className="font-semibold">浏览器数据搜索</h3>
      <p className="text-xs text-muted-foreground">仅在本机检索。书签导入和会话捕获分别按需申请最小权限，不会通过本按钮自动导入数据。</p>
      {isExtensionRuntime() ? <><Button type="button" size="sm" variant="outline" onClick={enableSearch}>授权命令中心浏览器搜索</Button>
        <p className="text-xs">已授权：{Object.entries(permissions).filter(([, granted]) => granted).map(([key]) => browserPermissionLabels[key]).join('、') || '暂无'}</p></> : <p className="text-xs">Web 模式不支持读取浏览器书签和标签页；仍可导入书签文件。</p>}
    </section>
  </div>;
};
export default SyncControls;
