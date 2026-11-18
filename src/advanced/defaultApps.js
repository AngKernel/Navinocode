const logoUrl = (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
const localSvg = (name) => `/svgs/${name}.svg`;

export const DEFAULT_APPS = [
  { id: 1, name: 'GitHub', url: 'https://github.com', icon: localSvg('github') },
  { id: 2, name: 'bilibili', url: 'https://www.bilibili.com', icon: localSvg('bilibili') },
  { id: 3, name: 'Blog', url: 'https://lover.nyc.mn', icon: '/icons/blog.png' },
  { id: 4, name: 'Gmail', url: 'https://mail.google.com', icon: localSvg('gmail') },
  { id: 5, name: 'Qwen', url: 'https://chat.qwen.ai/', icon: localSvg('qwen') },
  { id: 6, name: 'Z.ai', url: 'https://chat.z.ai/', icon: localSvg('zai') },
  { id: 7, name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: localSvg('deepseek') },
  { id: 8, name: '豆包', url: 'https://www.doubao.com/chat/', icon: localSvg('doubao') },
];

const LEGACY_DEFAULT_APPS = [
  { name: 'Gmail', url: 'https://mail.google.com', icon: 'gmail' },
  { name: 'YouTube', url: 'https://www.youtube.com', icon: 'youtube' },
  { name: 'GitHub', url: 'https://github.com', icon: 'github' },
  { name: 'Twitter', url: 'https://twitter.com', icon: 'twitter' },
  { name: 'Facebook', url: 'https://facebook.com', icon: 'facebook' },
  { name: 'Instagram', url: 'https://instagram.com', icon: 'instagram' },
  { name: 'LinkedIn', url: 'https://linkedin.com', icon: 'linkedin' },
  { name: 'Reddit', url: 'https://reddit.com', icon: 'reddit' },
];

const PREVIOUS_DEFAULT_APPS = [
  { name: 'GitHub', url: 'https://github.com', icon: logoUrl('github.com') },
  { name: 'bilibili', url: 'https://www.bilibili.com', icon: logoUrl('bilibili.com') },
  { name: 'Blog', url: 'https://lover.nyc.mn', icon: logoUrl('lover.nyc.mn') },
  { name: 'Gmail', url: 'https://mail.google.com', icon: logoUrl('mail.google.com') },
  { name: 'Qwen', url: 'https://chat.qwen.ai/', icon: logoUrl('chat.qwen.ai') },
  { name: 'Z.ai', url: 'https://chat.z.ai/', icon: logoUrl('chat.z.ai') },
];

const INTERMEDIATE_DEFAULT_APPS = [
  { name: 'GitHub', url: 'https://github.com', icon: localSvg('github') },
  { name: 'bilibili', url: 'https://www.bilibili.com', icon: localSvg('bilibili') },
  { name: 'Blog', url: 'https://lover.nyc.mn', icon: logoUrl('lover.nyc.mn') },
  { name: 'Gmail', url: 'https://mail.google.com', icon: logoUrl('mail.google.com') },
  { name: 'Qwen', url: 'https://chat.qwen.ai/', icon: localSvg('qwen') },
  { name: 'Z.ai', url: 'https://chat.z.ai/', icon: localSvg('zai') },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: localSvg('deepseek') },
];

const PRE_DOUBAO_DEFAULT_APPS = [
  { name: 'GitHub', url: 'https://github.com', icon: localSvg('github') },
  { name: 'bilibili', url: 'https://www.bilibili.com', icon: localSvg('bilibili') },
  { name: 'Blog', url: 'https://lover.nyc.mn', icon: '/icons/blog.png' },
  { name: 'Gmail', url: 'https://mail.google.com', icon: logoUrl('mail.google.com') },
  { name: 'Qwen', url: 'https://chat.qwen.ai/', icon: localSvg('qwen') },
  { name: 'Z.ai', url: 'https://chat.z.ai/', icon: localSvg('zai') },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: localSvg('deepseek') },
];

const PRE_GMAIL_SVG_DEFAULT_APPS = [
  { name: 'GitHub', url: 'https://github.com', icon: localSvg('github') },
  { name: 'bilibili', url: 'https://www.bilibili.com', icon: localSvg('bilibili') },
  { name: 'Blog', url: 'https://lover.nyc.mn', icon: '/icons/blog.png' },
  { name: 'Gmail', url: 'https://mail.google.com', icon: logoUrl('mail.google.com') },
  { name: 'Qwen', url: 'https://chat.qwen.ai/', icon: localSvg('qwen') },
  { name: 'Z.ai', url: 'https://chat.z.ai/', icon: localSvg('zai') },
  { name: 'DeepSeek', url: 'https://chat.deepseek.com/', icon: localSvg('deepseek') },
  { name: '豆包', url: 'https://www.doubao.com/chat/', icon: localSvg('doubao') },
];

const isMatchingDefaultApps = (apps, defaults) => (
  Array.isArray(apps) &&
  apps.length === defaults.length &&
  apps.every((app, index) => {
    const item = defaults[index];
    return app?.name === item.name && app?.url === item.url && app?.icon === item.icon;
  })
);

export const shouldMigrateDefaultApps = (apps) => (
  isMatchingDefaultApps(apps, LEGACY_DEFAULT_APPS) ||
  isMatchingDefaultApps(apps, PREVIOUS_DEFAULT_APPS) ||
  isMatchingDefaultApps(apps, INTERMEDIATE_DEFAULT_APPS) ||
  isMatchingDefaultApps(apps, PRE_DOUBAO_DEFAULT_APPS) ||
  isMatchingDefaultApps(apps, PRE_GMAIL_SVG_DEFAULT_APPS)
);
