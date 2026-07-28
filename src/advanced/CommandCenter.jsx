import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Calculator, CheckSquare, Command, Globe, History, PanelsTopLeft, Search, Timer, Wand2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { getActiveWorkspace, loadAdvancedState } from './storage';
import {
  getBrowserPermissionState,
  isExtensionRuntime,
  openBrowserResult,
  requestBrowserSearchPermissions,
  searchBrowserData,
} from './browserData';

const ENGINE_URLS = {
  google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  bing: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  baidu: (query) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
  duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
};

const COMMAND_PREFIXES = {
  g: 'google',
  b: 'bing',
  bd: 'baidu',
  ddg: 'duckduckgo',
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const addTodo = (text) => {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  let todos = [];
  try {
    todos = safeArray(JSON.parse(localStorage.getItem('todos') || '[]'));
  } catch {}
  todos.push({ id: Date.now(), text: trimmed, completed: false });
  localStorage.setItem('todos', JSON.stringify(todos));
  return true;
};

const setPomodoro = (minutes) => {
  const value = Number.parseInt(minutes, 10);
  if (!Number.isFinite(value) || value < 1 || value > 180) return false;
  localStorage.setItem('pomodoro_minutes', String(value));
  let settings = {};
  try {
    settings = JSON.parse(localStorage.getItem('componentSettings') || '{}') || {};
  } catch {}
  localStorage.setItem('componentSettings', JSON.stringify({ ...settings, pomodoro: true }));
  return true;
};

const calculate = (expression) => {
  const normalized = String(expression || '').replace(/\s+/g, '');
  if (!normalized || !/^[0-9+\-*/().%]+$/.test(normalized)) return null;
  const tokens = normalized.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];
  if (tokens.join('') !== normalized) return null;
  let index = 0;

  const parsePrimary = () => {
    const token = tokens[index];
    if (token === '(') {
      index += 1;
      const value = parseExpression();
      if (tokens[index] !== ')') throw new Error('missing closing parenthesis');
      index += 1;
      return value;
    }
    if (!/^\d+(?:\.\d+)?$/.test(token || '')) throw new Error('number expected');
    index += 1;
    return Number(token);
  };

  const parseUnary = () => {
    if (tokens[index] === '+') {
      index += 1;
      return parseUnary();
    }
    if (tokens[index] === '-') {
      index += 1;
      return -parseUnary();
    }
    return parsePrimary();
  };

  const parseTerm = () => {
    let value = parseUnary();
    while (['*', '/', '%'].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = parseUnary();
      if (operator === '*') value *= right;
      else if (operator === '/') value /= right;
      else value %= right;
    }
    return value;
  };

  const parseExpression = () => {
    let value = parseTerm();
    while (['+', '-'].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  };

  try {
    const value = parseExpression();
    if (index !== tokens.length || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
};

const parseDirectCommand = (rawQuery) => {
  const query = String(rawQuery || '').trim();
  const [prefix, ...rest] = query.split(/\s+/);
  const argument = rest.join(' ').trim();
  const engine = COMMAND_PREFIXES[prefix?.toLowerCase()];
  if (engine && argument) return { type: 'search', engine, argument };
  if (prefix?.toLowerCase() === 'todo' && argument) return { type: 'todo', argument };
  if (prefix?.toLowerCase() === 'timer' && argument) return { type: 'timer', argument };
  if (prefix?.toLowerCase() === 'theme' && ['light', 'dark', 'system'].includes(argument.toLowerCase())) {
    return { type: 'theme', argument: argument.toLowerCase() };
  }
  if (prefix?.toLowerCase() === 'calc' && argument) return { type: 'calc', argument };
  return null;
};

const openUrl = (url) => {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    window.open(parsed.href, '_blank', 'noopener,noreferrer');
  } catch {
    toast('网址无效');
  }
};

const resultIcon = (type) => {
  if (type === 'app') return <Globe className="h-4 w-4" />;
  if (type === 'todo') return <CheckSquare className="h-4 w-4" />;
  if (type === 'timer') return <Timer className="h-4 w-4" />;
  if (type === 'calc') return <Calculator className="h-4 w-4" />;
  if (type === 'theme') return <Wand2 className="h-4 w-4" />;
  if (type === 'tab') return <PanelsTopLeft className="h-4 w-4" />;
  if (type === 'bookmark') return <Bookmark className="h-4 w-4" />;
  if (type === 'history' || type === 'topSite') return <History className="h-4 w-4" />;
  return <Search className="h-4 w-4" />;
};

const CommandCenter = ({ open, onOpenChange, extraResults = [], onQueryChange }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [browserResults, setBrowserResults] = useState([]);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    getBrowserPermissionState().then((permissions) => {
      setBrowserEnabled(Object.values(permissions).some(Boolean));
    });
  }, [open]);

  useEffect(() => {
    onQueryChange?.(query);
  }, [query, onQueryChange]);

  useEffect(() => {
    const normalized = query.trim();
    if (!open || !browserEnabled || normalized.length < 2) {
      setBrowserResults([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const items = await searchBrowserData(normalized);
      if (!cancelled) setBrowserResults(items);
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, browserEnabled]);

  const results = useMemo(() => {
    const state = loadAdvancedState();
    const workspace = getActiveWorkspace(state);
    const normalized = query.trim().toLowerCase();
    const folderNames = new Map();
    safeArray(workspace?.folders).forEach((folder) => {
      safeArray(folder.appIds).forEach((appId) => folderNames.set(String(appId), folder.name));
    });

    const items = safeArray(workspace?.apps)
      .filter((app) => !normalized || `${app?.name || ''} ${app?.url || ''}`.toLowerCase().includes(normalized))
      .slice(0, 8)
      .map((app) => ({
        id: `app-${app.id}`,
        type: 'app',
        title: app.name || app.url,
        subtitle: folderNames.get(String(app.id)) || app.url,
        run: () => openUrl(app.url),
      }));

    const direct = parseDirectCommand(query);
    if (direct?.type === 'search') {
      items.unshift({
        id: 'direct-search', type: 'search',
        title: `使用 ${direct.engine} 搜索“${direct.argument}”`,
        subtitle: `${query.split(/\s+/)[0]} + 关键词`,
        run: () => openUrl(ENGINE_URLS[direct.engine](direct.argument)),
      });
    } else if (direct?.type === 'todo') {
      items.unshift({
        id: 'direct-todo', type: 'todo', title: `新建待办：${direct.argument}`,
        subtitle: 'todo + 内容',
        run: () => {
          if (addTodo(direct.argument)) {
            toast('待办已添加');
            setTimeout(() => window.location.reload(), 250);
          }
        },
      });
    } else if (direct?.type === 'timer') {
      items.unshift({
        id: 'direct-timer', type: 'timer', title: `启动 ${direct.argument} 分钟番茄钟`,
        subtitle: 'timer + 1～180 分钟',
        run: () => {
          if (!setPomodoro(direct.argument)) return toast('请输入 1～180 分钟');
          toast('番茄钟已设置');
          setTimeout(() => window.location.reload(), 250);
        },
      });
    } else if (direct?.type === 'theme') {
      items.unshift({
        id: 'direct-theme', type: 'theme', title: `切换到 ${direct.argument} 主题`,
        subtitle: 'theme light / dark / system',
        run: () => {
          localStorage.setItem('themeMode', direct.argument);
          window.location.reload();
        },
      });
    } else if (direct?.type === 'calc') {
      const answer = calculate(direct.argument);
      if (answer !== null) {
        items.unshift({
          id: 'direct-calc', type: 'calc', title: `${direct.argument} = ${answer}`,
          subtitle: '点击复制结果',
          run: async () => {
            await navigator.clipboard?.writeText(String(answer));
            toast('结果已复制');
          },
        });
      }
    }

    const externalItems = browserResults.map((item) => ({
      ...item,
      id: `browser-${item.id}`,
      title: item.title,
      subtitle: `${item.type === 'tab' ? '标签页' : item.type === 'bookmark' ? '书签' : item.type === 'history' ? '历史记录' : '常用网站'} · ${item.subtitle || ''}`,
      run: () => openBrowserResult(item),
    }));

    if (query.trim() && isExtensionRuntime() && !browserEnabled) {
      items.push({
        id: 'enable-browser-search',
        type: 'bookmark',
        title: '启用浏览器书签与标签页搜索',
        subtitle: '仅在点击后申请书签、历史、标签页和常用网站权限',
        keepOpen: true,
        run: async () => {
          const granted = await requestBrowserSearchPermissions();
          setBrowserEnabled(granted);
          toast(granted ? '浏览器搜索已启用' : '未授予浏览器搜索权限');
        },
      });
    }

    if (query.trim() && !direct) {
      const engine = localStorage.getItem('searchEngine') || 'bing';
      items.push({
        id: 'fallback-search', type: 'search', title: `搜索“${query.trim()}”`,
        subtitle: `使用 ${engine}`,
        run: () => openUrl((ENGINE_URLS[engine] || ENGINE_URLS.bing)(query.trim())),
      });
    }

    return [...items, ...externalItems, ...extraResults].slice(0, 12);
  }, [query, browserResults, browserEnabled, extraResults]);

  useEffect(() => setActiveIndex(0), [query, browserResults, extraResults]);

  const runAt = (index) => {
    const item = results[index];
    if (!item) return;
    if (!item.keepOpen) onOpenChange(false);
    Promise.resolve(item.run?.()).catch((error) => toast(error?.message || '操作失败'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl overflow-hidden rounded-3xl border-white/20 bg-white/90 p-0 shadow-2xl backdrop-blur-xl dark:bg-gray-950/90">
        <DialogTitle className="sr-only">命令中心</DialogTitle>
        <div className="flex items-center gap-3 border-b border-gray-200/60 px-4 dark:border-gray-800/70">
          <Command className="h-5 w-5 text-gray-500" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((value) => Math.min(results.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                runAt(activeIndex);
              }
            }}
            placeholder="搜索应用、书签、标签页，或输入 g / todo / timer / calc / theme…"
            className="h-16 border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
          />
          <kbd className="rounded-lg border px-2 py-1 text-xs text-gray-500">Esc</kbd>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-gray-500">没有匹配结果</div>
          ) : results.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => runAt(index)}
              className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors ${
                activeIndex === index ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-900'
              }`}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {item.icon || resultIcon(item.type)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                {item.subtitle ? <span className="block truncate text-xs text-gray-500">{item.subtitle}</span> : null}
              </span>
              <span className="text-xs text-gray-400">Enter</span>
            </button>
          ))}
        </div>
        <div className="border-t border-gray-200/60 px-4 py-2 text-xs text-gray-500 dark:border-gray-800/70">
          快捷键：Ctrl/⌘ + K；浏览器数据仅在授权后本地读取
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CommandCenter;
