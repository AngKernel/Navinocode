import React, { useMemo, useState } from 'react';
import { ImageIcon, RefreshCcw, Type, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SiteIcon from '@/components/SiteIcon';
import {
  buildIconFields,
  getAppHostname,
  ICON_MODE_AUTO,
  ICON_MODE_CUSTOM,
  ICON_MODE_LETTER,
  normalizeAppUrl,
} from '@/lib/siteIcons';

const ICON_MODES = [
  { id: ICON_MODE_AUTO, label: '自动获取', icon: RefreshCcw },
  { id: ICON_MODE_CUSTOM, label: '自定义', icon: ImageIcon },
  { id: ICON_MODE_LETTER, label: '首字母', icon: Type },
];

const AddAppDialog = ({ isOpen, setIsOpen, setApps }) => {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('');
  const [iconMode, setIconMode] = useState(ICON_MODE_AUTO);

  const normalizedUrl = normalizeAppUrl(url);
  const previewName = name.trim() || getAppHostname(normalizedUrl) || '应用';
  const previewApp = useMemo(() => ({
    name: previewName,
    url: normalizedUrl,
    ...buildIconFields({ url: normalizedUrl, icon, iconMode }),
  }), [icon, iconMode, normalizedUrl, previewName]);

  const resetForm = () => {
    setUrl('');
    setName('');
    setIcon('');
    setIconMode(ICON_MODE_AUTO);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!normalizedUrl) {
      toast('请输入有效的 http(s) 网站地址');
      return;
    }

    const appName = name.trim() || getAppHostname(normalizedUrl) || '应用';
    const iconFields = buildIconFields({ url: normalizedUrl, icon, iconMode });
    setApps((previous) => {
      const numericIds = previous.map((app) => Number(app.id)).filter(Number.isFinite);
      const newId = Math.max(0, ...numericIds) + 1;
      return [...previous, {
        id: newId,
        name: appName,
        url: normalizedUrl,
        ...iconFields,
      }];
    });
    setIsOpen(false);
    resetForm();
  };

  const handleIconFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      setIcon(String(loadEvent.target?.result || ''));
      setIconMode(ICON_MODE_CUSTOM);
    };
    reader.readAsDataURL(file);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      setIsOpen(open);
      if (!open) resetForm();
    }}>
      <DialogContent className="max-w-md rounded-2xl p-6 apple-popover">
        <DialogHeader>
          <DialogTitle>添加新应用</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="url">网址 *</Label>
            <Input
              id="url"
              type="text"
              placeholder="例如：linux.do"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
              className="apple-input"
            />
          </div>

          <div>
            <Label htmlFor="name">应用名称</Label>
            <Input
              id="name"
              type="text"
              placeholder="留空则使用网站域名"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="apple-input"
            />
          </div>

          <div className="space-y-2">
            <Label>图标来源</Label>
            <div className="grid grid-cols-3 gap-2">
              {ICON_MODES.map(({ id, label, icon: ModeIcon }) => (
                <Button
                  key={id}
                  type="button"
                  variant={iconMode === id ? 'secondary' : 'outline'}
                  className="h-auto rounded-xl px-2 py-2 text-xs"
                  onClick={() => setIconMode(id)}
                >
                  <ModeIcon className="mr-1 h-3.5 w-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </div>

          {iconMode === ICON_MODE_CUSTOM ? (
            <div>
              <Label htmlFor="icon">图标 URL 或本地图片</Label>
              <div className="relative">
                <Input
                  id="icon"
                  type="text"
                  placeholder="https://example.com/icon.png"
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  className="apple-input pr-10"
                />
                <label
                  htmlFor="icon-upload"
                  className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
                  title="上传本地图标"
                >
                  <Upload size={16} className="text-gray-500 dark:text-gray-400" />
                </label>
                <input
                  id="icon-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleIconFileChange}
                  className="hidden"
                />
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3 rounded-2xl border border-gray-200/60 bg-white/40 p-3 dark:border-gray-700/60 dark:bg-black/10">
            <SiteIcon app={previewApp} size={48} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{previewName}</div>
              <div className="truncate text-xs text-gray-500">
                {iconMode === ICON_MODE_AUTO
                  ? '按标准化域名自动匹配图标'
                  : iconMode === ICON_MODE_CUSTOM
                    ? '使用你提供的图片'
                    : '使用应用名称首字母'}
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsOpen(false)} className="apple-button">
              取消
            </Button>
            <Button type="submit" className="rounded-2xl bg-white px-4 py-2 text-black hover:bg-gray-100 dark:bg-gray-800 dark:text-white dark:hover:bg-gray-700">
              添加应用
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddAppDialog;
