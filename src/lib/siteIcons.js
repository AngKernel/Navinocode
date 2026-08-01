const ADVANCED_STATE_KEY = 'navinocode_advanced_state';

export const ICON_MODE_AUTO = 'auto';
export const ICON_MODE_CUSTOM = 'custom';
export const ICON_MODE_LETTER = 'letter';

const AUTO_ICON_HOSTS = [
  ['mail.google.com', '/svgs/gmail.svg'],
  ['github.com', '/svgs/github.svg'],
  ['bilibili.com', '/svgs/bilibili.svg'],
  ['chat.qwen.ai', '/svgs/qwen.svg'],
  ['chat.z.ai', '/svgs/zai.svg'],
  ['chat.deepseek.com', '/svgs/deepseek.svg'],
  ['doubao.com', '/svgs/doubao.svg'],
];

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const isHttpUrl = (value) => /^https?:\/\//i.test(String(value || ''));
const isDataUrl = (value) => String(value || '').startsWith('data:');
const isLocalAsset = (value) => String(value || '').startsWith('/');

export const normalizeAppUrl = (raw) => {
  const value = String(raw || '').trim();
  if (!value) return '';
  const withProtocol = value.startsWith('//')
    ? `https:${value}`
    : /^https?:\/\//i.test(value)
      ? value
      : `https://${value}`;

  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
};

export const getAppHostname = (rawUrl) => {
  const normalized = normalizeAppUrl(rawUrl);
  if (!normalized) return '';
  try {
    return new URL(normalized).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

const findBundledIcon = (hostname) => {
  if (!hostname) return '';
  const match = AUTO_ICON_HOSTS.find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`));
  return match?.[1] || '';
};

export const isLegacyAutoIcon = (icon) => {
  const value = String(icon || '');
  return /icon\.bqb\.cool/i.test(value) || /google\.com\/s2\/favicons/i.test(value);
};

export const getAutoIconUrl = (rawUrl) => {
  const normalized = normalizeAppUrl(rawUrl);
  if (!normalized) return '';
  const hostname = getAppHostname(normalized);
  const bundled = findBundledIcon(hostname);
  if (bundled) return bundled;

  try {
    const origin = new URL(normalized).origin;
    return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(origin)}&sz=128`;
  } catch {
    return '';
  }
};

export const inferIconMode = (app) => {
  if ([ICON_MODE_AUTO, ICON_MODE_CUSTOM, ICON_MODE_LETTER].includes(app?.iconMode)) {
    return app.iconMode;
  }

  const icon = String(app?.icon || '').trim();
  if (!icon || isLegacyAutoIcon(icon)) return ICON_MODE_AUTO;
  if (isHttpUrl(icon) || isDataUrl(icon) || isLocalAsset(icon)) return ICON_MODE_CUSTOM;
  if (findBundledIcon(getAppHostname(app?.url))) return ICON_MODE_AUTO;
  return ICON_MODE_LETTER;
};

export const buildIconFields = ({ url, icon = '', iconMode = ICON_MODE_AUTO }) => {
  const normalizedUrl = normalizeAppUrl(url);
  const requestedMode = [ICON_MODE_AUTO, ICON_MODE_CUSTOM, ICON_MODE_LETTER].includes(iconMode)
    ? iconMode
    : ICON_MODE_AUTO;

  if (requestedMode === ICON_MODE_LETTER) {
    return { icon: '', iconMode: ICON_MODE_LETTER, iconSource: 'letter' };
  }

  const customIcon = String(icon || '').trim();
  if (requestedMode === ICON_MODE_CUSTOM && customIcon && (isHttpUrl(customIcon) || isDataUrl(customIcon) || isLocalAsset(customIcon))) {
    const source = isDataUrl(customIcon)
      ? 'upload'
      : isLocalAsset(customIcon)
        ? 'builtin'
        : 'custom-url';
    return { icon: customIcon, iconMode: ICON_MODE_CUSTOM, iconSource: source };
  }

  const autoIcon = getAutoIconUrl(normalizedUrl);
  return {
    icon: autoIcon,
    iconMode: ICON_MODE_AUTO,
    iconSource: autoIcon.startsWith('/') ? 'builtin' : 'google-s2',
  };
};

export const normalizeAppIconRecord = (app) => {
  if (!app || typeof app !== 'object') return app;
  const mode = inferIconMode(app);

  if (mode === ICON_MODE_AUTO) {
    return { ...app, ...buildIconFields({ url: app.url, iconMode: ICON_MODE_AUTO }) };
  }

  if (mode === ICON_MODE_LETTER) {
    return {
      ...app,
      iconMode: ICON_MODE_LETTER,
      iconSource: app.iconSource || 'letter',
    };
  }

  const customIcon = String(app.icon || '').trim();
  return {
    ...app,
    iconMode: ICON_MODE_CUSTOM,
    iconSource: app.iconSource || (isDataUrl(customIcon) ? 'upload' : isLocalAsset(customIcon) ? 'builtin' : 'custom-url'),
  };
};

export const getIconCandidates = (app) => {
  const normalized = normalizeAppIconRecord(app || {});
  const mode = inferIconMode(normalized);
  if (mode === ICON_MODE_LETTER) return [];

  const autoIcon = getAutoIconUrl(normalized.url);
  const candidates = mode === ICON_MODE_CUSTOM
    ? [normalized.icon, autoIcon]
    : [autoIcon];

  return [...new Set(candidates.filter(Boolean))];
};

const migrateList = (apps) => {
  if (!Array.isArray(apps)) return { apps, changed: false, migrated: 0 };
  let changed = false;
  let migrated = 0;
  const next = apps.map((app) => {
    const normalized = normalizeAppIconRecord(app);
    if (JSON.stringify(normalized) !== JSON.stringify(app)) {
      changed = true;
      migrated += 1;
    }
    return normalized;
  });
  return { apps: next, changed, migrated };
};

export const migrateStoredAppIcons = () => {
  if (typeof window === 'undefined' || !window.localStorage) return { changed: false, migrated: 0 };

  let changed = false;
  let migrated = 0;
  const storedApps = safeParse(localStorage.getItem('apps'), null);
  const localResult = migrateList(storedApps);
  if (localResult.changed) {
    localStorage.setItem('apps', JSON.stringify(localResult.apps));
    changed = true;
    migrated += localResult.migrated;
  }

  const advanced = safeParse(localStorage.getItem(ADVANCED_STATE_KEY), null);
  if (advanced && Array.isArray(advanced.workspaces)) {
    let workspaceChanged = false;
    const workspaces = advanced.workspaces.map((workspace) => {
      const result = migrateList(workspace?.apps);
      if (result.changed) {
        workspaceChanged = true;
        migrated += result.migrated;
        return { ...workspace, apps: result.apps };
      }
      return workspace;
    });

    if (workspaceChanged) {
      localStorage.setItem(ADVANCED_STATE_KEY, JSON.stringify({ ...advanced, workspaces }));
      changed = true;
    }
  }

  return { changed, migrated };
};
