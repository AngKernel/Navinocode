import React, { useEffect, useState } from 'react';
import { Bookmark, Cloud, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  browserPermissionLabels,
  getBrowserPermissionState,
  isExtensionRuntime,
  requestBrowserSearchPermissions,
} from './browserData';
import {
  disableNativeSync,
  enableNativeSync,
  hasNativeSync,
  pullNativeSnapshot,
  pushNativeSnapshot,
} from './nativeSync';
import { isNativeSyncEnabled } from './storage';

const SyncControls = () => {
  const [permissions, setPermissions] = useState({});
  const [nativeEnabled, setNativeEnabledState] = useState(() => isNativeSyncEnabled());
  const [busy, setBusy] = useState(false);

  const refreshPermissions = async () => setPermissions(await getBrowserPermissionState());
  useEffect(() => { refreshPermissions(); }, []);

  const enableBrowserSearch = async () => {
    const granted = await requestBrowserSearchPermissions();
    await refreshPermissions();
    toast(granted ? '浏览器数据搜索已启用' : '未授予浏览器数据权限');
  };

  const toggleNativeSync = async () => {
    if (nativeEnabled) {
      disableNativeSync();
      setNativeEnabledState(false);
      toast('浏览器原生同步已关闭');
      return;
    }
    setBusy(true);
    try {
      await enableNativeSync();
      setNativeEnabledState(true);
      toast('浏览器原生同步已启用');
    } catch (error) {
      toast(error.message || '启用同步失败');
    } finally {
      setBusy(false);
    }
  };

  const runSync = async (direction) => {
    setBusy(true);
    try {
      const result = direction === 'push' ? await pushNativeSnapshot() : await pullNativeSnapshot();
      toast(direction === 'push' ? '已上传到浏览器账户' : result.found ? '已从浏览器账户恢复' : '浏览器账户暂无数据');
      if (direction === 'pull' && result.changed) setTimeout(() => window.location.reload(), 250);
    } catch (error) {
      toast(error.message || '同步失败');
    } finally {
      setBusy(false);
    }
  };

  const grantedLabels = Object.entries(permissions)
    .filter(([, granted]) => granted)
    .map(([key]) => browserPermissionLabels[key]);

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Bookmark className="h-4 w-4" />浏览器数据搜索
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500">
          权限按需申请，数据只在本机用于命令中心检索，不会写入云端同步。
        </p>
        {isExtensionRuntime() ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="rounded-xl" onClick={enableBrowserSearch}>
              授权书签、历史与标签页
            </Button>
            <span className="text-xs text-gray-500">
              {grantedLabels.length ? `已授权：${grantedLabels.join('、')}` : '尚未授权'}
            </span>
          </div>
        ) : <p className="text-xs text-gray-500">Web 模式不支持浏览器书签和标签页 API。</p>}
      </div>

      <div className="border-t pt-5">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <Cloud className="h-4 w-4" />浏览器原生同步
        </div>
        <p className="mb-3 text-xs leading-relaxed text-gray-500">
          使用 Edge/Chromium 账户的 storage.sync，同步应用、待办、工作空间和轻量设置；本地背景图片不会上传。
        </p>
        {hasNativeSync() ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={nativeEnabled ? 'secondary' : 'default'} className="rounded-xl" disabled={busy} onClick={toggleNativeSync}>
              {nativeEnabled ? '关闭自动同步' : '启用自动同步'}
            </Button>
            <Button type="button" variant="outline" className="rounded-xl" disabled={busy} onClick={() => runSync('push')}>
              <Upload className="mr-2 h-4 w-4" />立即上传
            </Button>
            <Button type="button" variant="outline" className="rounded-xl" disabled={busy} onClick={() => runSync('pull')}>
              <Download className="mr-2 h-4 w-4" />立即下载
            </Button>
          </div>
        ) : <p className="text-xs text-gray-500">仅扩展模式支持浏览器账户同步。</p>}
      </div>
    </div>
  );
};

export default SyncControls;
