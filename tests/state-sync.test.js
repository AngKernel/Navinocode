import test, { beforeEach } from 'node:test';
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;
globalThis.CustomEvent ??= class CustomEvent extends Event {
  constructor(type, options = {}) { super(type); this.detail = options.detail; }
};
import assert from 'node:assert/strict';
import * as storage from '../src/advanced/storage.js';
import { mergeEntityArrays, mergeSnapshots, stableSnapshotString } from '../src/advanced/syncMerge.js';
import * as native from '../src/advanced/nativeSync.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const META = 'navinocode_sync_meta';
const CHUNK = 'navinocode_sync_chunk_';
const HASH = 'navinocode_native_sync_hash';
let remote, intervals, timeouts, listeners, stats, failGet, beforeGet, beforeSet;
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const app = (id, url = `https://example.com/${id}`) => ({ id, name: `App ${id}`, url });
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const seed = () => {
  write('apps', [app(1)]);
  write('todos', [{ id: 1, text: 'existing', completed: false }]);
  return storage.loadAdvancedState();
};
const setRemote = (payload, revision = 2, deviceId = 'remote-device') => {
  const envelope = { version: 1, revision, deviceId, updatedAt: '2026-09-16T00:00:00.000Z', payload };
  const text = JSON.stringify(envelope);
  const chunks = [];
  for (let i = 0; i < text.length; i += 1800) chunks.push(text.slice(i, i + 1800));
  remote = { [META]: { version: 1, revision, deviceId, updatedAt: envelope.updatedAt, chunks: chunks.length } };
  chunks.forEach((chunk, i) => { remote[`${CHUNK}${i}`] = chunk; });
};
const remoteEnvelope = () => JSON.parse(Array.from({ length: remote[META].chunks }, (_, i) => remote[`${CHUNK}${i}`]).join(''));

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
  globalThis.document = { visibilityState: 'visible' };
  remote = {};
  intervals = new Map();
  timeouts = new Map();
  listeners = new Set();
  stats = { gets: 0, sets: 0, removes: 0 };
  failGet = false;
  beforeGet = null;
  beforeSet = null;
  let nextTimer = 0;
  window.setInterval = (fn) => { const id = ++nextTimer; intervals.set(id, fn); return id; };
  window.clearInterval = (id) => intervals.delete(id);
  window.setTimeout = (fn) => { const id = ++nextTimer; timeouts.set(id, fn); return id; };
  window.clearTimeout = (id) => timeouts.delete(id);
  globalThis.chrome = {
    runtime: { id: 'test-extension' },
    storage: {
      sync: {
        get(keys, callback) {
          stats.gets++;
          void (async () => {
            if (beforeGet) await beforeGet();
            if (failGet) {
              chrome.runtime.lastError = { message: 'simulated read failure' };
              callback();
              delete chrome.runtime.lastError;
              return;
            }
            const selected = typeof keys === 'string' ? [keys] : keys;
            callback(structuredClone(Object.fromEntries(selected.filter((key) => key in remote).map((key) => [key, remote[key]]))));
          })();
        },
        set(values, callback) {
          stats.sets++;
          void (async () => {
            if (beforeSet) await beforeSet();
            Object.assign(remote, structuredClone(values));
            callback();
          })();
        },
        remove(keys, callback) { stats.removes++; keys.forEach((key) => delete remote[key]); callback(); },
      },
      onChanged: {
        addListener(fn) { listeners.add(fn); },
        removeListener(fn) { listeners.delete(fn); },
      },
    },
  };
});

test('missing numeric settings use defaults, rather than Number(null)', () => {
  const settings = storage.readWorkspaceSettings();
  assert.equal(settings.backgroundBrightness, 100);
  assert.equal(settings.backgroundOverlay, 24);
  assert.equal(settings.bottomCount, 8);
  assert.equal(settings.pomodoroMinutes, 25);
});

test('numeric workspace settings preserve explicit zero and clamp ranges', () => {
  for (const key of ['backgroundBrightness', 'backgroundOverlay', 'bottomCount']) localStorage.setItem(key, '0');
  localStorage.setItem('backgroundBlur', '999');
  localStorage.setItem('pomodoro_minutes', 'invalid');
  const settings = storage.readWorkspaceSettings();
  assert.equal(settings.backgroundBrightness, 0);
  assert.equal(settings.backgroundOverlay, 0);
  assert.equal(settings.bottomCount, 0);
  assert.equal(settings.backgroundBlur, 20);
  assert.equal(settings.pomodoroMinutes, 25);
});

test('invalid and whitespace numeric settings fall back safely', () => {
  localStorage.setItem('backgroundBrightness', '   ');
  localStorage.setItem('bottomCount', 'nope');
  assert.equal(storage.readWorkspaceSettings().backgroundBrightness, 100);
  assert.equal(storage.readWorkspaceSettings().bottomCount, 8);
});

test('workspace reader tolerates invalid stored JSON', () => {
  localStorage.setItem('todos', '{broken');
  localStorage.setItem('componentSettings', 'null');
  assert.deepEqual(storage.readWorkspaceSettings().todos, []);
  assert.equal(storage.readWorkspaceSettings().componentSettings.todo, false);
});

test('renaming captures live apps, todos and settings without writing stale legacy values', () => {
  const state = seed();
  write('apps', [app(2)]);
  write('todos', [{ id: 2, text: 'new edit', completed: true }]);
  localStorage.setItem('themeMode', 'dark');
  const next = storage.renameWorkspace(state, state.activeWorkspaceId, 'renamed');
  assert.equal(storage.getActiveWorkspace(next).name, 'renamed');
  assert.deepEqual(storage.readLegacyApps(), [app(2)]);
  assert.equal(storage.getActiveWorkspace(next).settings.todos[0].text, 'new edit');
  assert.equal(localStorage.getItem('themeMode'), 'dark');
});

test('all folder metadata operations preserve edits made after the manager loaded', () => {
  let state = seed();
  state = storage.addFolder(state, 'work');
  const folderId = storage.getActiveWorkspace(state).folders[0].id;
  for (const operation of [
    (value) => storage.renameFolder(value, folderId, 'new name'),
    (value) => storage.toggleAppInFolder(value, folderId, 2),
    (value) => storage.deleteFolder(value, folderId),
    (value) => storage.addFolder(value, 'another'),
  ]) {
    write('apps', [app(2)]);
    localStorage.setItem('backgroundImage', 'local-background');
    state = operation(state);
    assert.deepEqual(storage.readLegacyApps(), [app(2)]);
    assert.equal(localStorage.getItem('backgroundImage'), 'local-background');
    assert.deepEqual(storage.getActiveWorkspace(state).apps, [app(2)]);
  }
});

test('compact snapshot round trip keeps omitted local background and data icons', () => {
  seed();
  write('apps', [{ ...app(1), icon: 'data:image/png;base64,LOCAL' }]);
  localStorage.setItem('backgroundImage', 'data:image/png;base64,BACKGROUND');
  const compact = storage.captureFullSnapshot({ compact: true });
  assert.equal(compact.backgroundImage, undefined);
  assert.equal(compact.apps[0].icon, undefined);
  compact.advancedState.workspaces[0].apps[0].name = 'remote rename';
  storage.applyFullSnapshot(compact);
  assert.equal(localStorage.getItem('backgroundImage'), 'data:image/png;base64,BACKGROUND');
  assert.equal(storage.readLegacyApps()[0].icon, 'data:image/png;base64,LOCAL');
  assert.equal(storage.readLegacyApps()[0].name, 'remote rename');
});

test('compact assets are restored per workspace, not copied from the active workspace', () => {
  let state = seed();
  localStorage.setItem('backgroundImage', 'first-background');
  state = storage.addWorkspace(state, 'second');
  localStorage.setItem('backgroundImage', 'second-background');
  const compact = storage.captureFullSnapshot({ compact: true });
  storage.applyFullSnapshot(compact);
  const restored = storage.loadAdvancedState({ captureLegacy: false });
  assert.equal(restored.workspaces[0].settings.backgroundImage, 'first-background');
  assert.equal(restored.workspaces[1].settings.backgroundImage, 'second-background');
});

test('explicit empty background and icon in a full snapshot still clear assets', () => {
  seed();
  write('apps', [{ ...app(1), icon: 'data:image/png;base64,LOCAL' }]);
  localStorage.setItem('backgroundImage', 'local-background');
  const snapshot = storage.captureFullSnapshot();
  snapshot.advancedState.workspaces[0].settings.backgroundImage = '';
  snapshot.advancedState.workspaces[0].apps[0].icon = '';
  storage.applyFullSnapshot(snapshot);
  assert.equal(localStorage.getItem('backgroundImage'), null);
  assert.equal(storage.readLegacyApps()[0].icon, '');
});

test('malformed advanced snapshot is rejected before any earlier top-level keys are written', () => {
  seed();
  const before = [...localStorage.values];
  assert.throws(() => storage.applyFullSnapshot({ apps: [app(2)], advancedState: { workspaces: [] } }), /配置格式无效/);
  assert.deepEqual([...localStorage.values], before);
});

test('future schema version does not overwrite local data', () => {
  seed();
  const snapshot = storage.captureFullSnapshot();
  const before = [...localStorage.values];
  snapshot.advancedState.schemaVersion = 4;
  assert.throws(() => storage.applyFullSnapshot(snapshot), /版本较新/);
  assert.deepEqual([...localStorage.values], before);
});

test('duplicate workspace ids and invalid active ids are rejected', () => {
  seed();
  const snapshot = storage.captureFullSnapshot();
  snapshot.advancedState.workspaces.push(structuredClone(snapshot.advancedState.workspaces[0]));
  assert.throws(() => storage.validateFullSnapshot(snapshot), /配置格式无效/);
  snapshot.advancedState.workspaces.pop();
  snapshot.advancedState.activeWorkspaceId = 'missing';
  assert.throws(() => storage.validateFullSnapshot(snapshot), /配置格式无效/);
});

test('invalid todo and app shapes are rejected', () => {
  assert.throws(() => storage.validateFullSnapshot({ todos: [null] }), /配置格式无效/);
  assert.throws(() => storage.validateFullSnapshot({ apps: [{}] }), /配置格式无效/);
  assert.throws(() => storage.validateFullSnapshot({ componentSettings: [] }), /配置格式无效/);
});

test('legacy top-level snapshots can still be applied', () => {
  storage.applyFullSnapshot({ apps: [app(3)], todos: [], backgroundBrightness: 0 });
  assert.deepEqual(storage.readLegacyApps(), [app(3)]);
  assert.equal(localStorage.getItem('backgroundBrightness'), '0');
});

test('URL paths and query values remain case sensitive during deduplication', () => {
  const values = ['https://example.com/Path', 'https://example.com/path', 'https://example.com/?q=A', 'https://example.com/?q=a'];
  assert.equal(mergeEntityArrays([], values.map((url, id) => app(id, url)), 'app').length, 4);
});

test('URL hostname case and normalized root URLs deduplicate', () => {
  const merged = mergeEntityArrays([app(1, 'https://EXAMPLE.com')], [app(2, 'https://example.com/')], 'app');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 2);
});

test('folders retain app membership when URL deduplication changes app ids', () => {
  const workspace = (id) => ({ id: 'w', apps: [app(id, 'https://example.com')], folders: [{ id: 'f', appIds: [String(id)] }], settings: {} });
  const base = { advancedState: { activeWorkspaceId: 'w', workspaces: [workspace(1)] } };
  const incoming = { advancedState: { activeWorkspaceId: 'w', workspaces: [workspace(2)] } };
  const active = mergeSnapshots(base, incoming).advancedState.workspaces[0];
  assert.equal(active.apps.length, 1);
  assert.deepEqual(active.folders[0].appIds, [String(active.apps[0].id)]);
});

test('legacy apps project only the active workspace instead of combining different workspaces', () => {
  const first = { id: 'first', apps: [app(1)], folders: [], settings: {} };
  const second = { id: 'second', apps: [app(2)], folders: [], settings: {} };
  const base = { apps: first.apps, advancedState: { activeWorkspaceId: 'first', workspaces: [first, second] } };
  const incoming = { apps: second.apps, advancedState: { activeWorkspaceId: 'second', workspaces: [first, second] } };
  assert.deepEqual(mergeSnapshots(base, incoming).apps, [app(2)]);
});

test('web mode reports unsupported browser sync', async () => {
  delete globalThis.chrome;
  assert.equal(native.hasNativeSync(), false);
  await assert.rejects(native.pushNativeSnapshot(), /扩展/);
});

test('enabling and disabling automatic sync starts and stops listeners immediately', async (t) => {
  seed();
  const stop = native.initializeNativeSync();
  t.after(stop);
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
  await native.enableNativeSync();
  await flush();
  assert.equal(storage.isNativeSyncEnabled(), true);
  assert.equal(intervals.size, 1);
  assert.equal(listeners.size, 1);
  native.disableNativeSync();
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
  const gets = stats.gets;
  await flush();
  assert.equal(stats.gets, gets);
});

test('a failed initial sync restores the disabled preference', async () => {
  seed();
  failGet = true;
  await assert.rejects(native.enableNativeSync(), /simulated/);
  assert.equal(storage.isNativeSyncEnabled(), false);
});

test('cleanup cancels an in-flight pull before applying remote data', async () => {
  seed();
  const payload = storage.captureFullSnapshot({ compact: true });
  payload.advancedState.workspaces[0].name = 'remote name';
  setRemote(payload);
  storage.setNativeSyncEnabled(true);
  let release;
  beforeGet = () => new Promise((resolve) => { release = resolve; });
  const stop = native.initializeNativeSync();
  await flush();
  assert.equal(typeof release, 'function');
  stop();
  beforeGet = null;
  release();
  await flush();
  assert.notEqual(storage.getActiveWorkspace(storage.loadAdvancedState()).name, 'remote name');
  assert.equal(localStorage.getItem('navinocode_native_sync_revision'), null);
  assert.equal(intervals.size, 0);
});

test('automatic sync errors are observable rather than silently discarded', async (t) => {
  seed();
  let message;
  window.addEventListener('navinocode:native-sync-error', (event) => { message = event.detail.message; });
  storage.setNativeSyncEnabled(true);
  failGet = true;
  const stop = native.initializeNativeSync();
  t.after(stop);
  await flush();
  assert.match(message, /simulated read failure/);
});

test('manual concurrent pushes serialize and allocate distinct revisions', async () => {
  seed();
  const results = await Promise.all([native.pushNativeSnapshot(), native.pushNativeSnapshot()]);
  assert.deepEqual(results.map((value) => value.revision), [1, 2]);
  assert.equal(remoteEnvelope().revision, 2);
});

test('pull acknowledges only remote data so local additions remain pending for upload', async () => {
  seed();
  const acknowledged = await native.pushNativeSnapshot();
  write('apps', [app(1), app(2)]);
  const result = await native.pullNativeSnapshot();
  assert.equal(result.payload.apps.length, 2);
  assert.equal(localStorage.getItem(HASH), stableSnapshotString(acknowledged.payload));
  assert.notEqual(localStorage.getItem(HASH), stableSnapshotString(result.payload));
});

test('the automatic pass uploads additions preserved by the initial pull', async (t) => {
  seed();
  await native.pushNativeSnapshot();
  write('apps', [app(1), app(2)]);
  storage.setNativeSyncEnabled(true);
  const stop = native.initializeNativeSync();
  t.after(stop);
  await flush();
  for (const tick of intervals.values()) tick();
  await flush();
  assert.equal(remoteEnvelope().payload.apps.length, 2);
});

test('incomplete chunks are rejected without altering local configuration', async () => {
  seed();
  setRemote(storage.captureFullSnapshot({ compact: true }));
  delete remote[`${CHUNK}0`];
  const before = [...localStorage.values];
  await assert.rejects(native.pullNativeSnapshot(), /尚未完整/);
  assert.deepEqual([...localStorage.values], before);
});

test('metadata/envelope revision mismatches are rejected', async () => {
  seed();
  setRemote(storage.captureFullSnapshot({ compact: true }));
  remote[META].revision++;
  await assert.rejects(native.pullNativeSnapshot(), /版本尚未一致/);
});

test('oversized chunk counts are rejected before reading or allocating chunk data', async () => {
  remote[META] = { version: 1, chunks: 1000000000 };
  await assert.rejects(native.pullNativeSnapshot(), /元数据无效/);
  assert.equal(stats.gets, 1);
});

test('quota accounts for the JSON escaping of chunks, not just raw payload bytes', async () => {
  seed();
  write('todos', [{ id: 3, text: '\\'.repeat(12000), completed: false }]);
  const payload = storage.captureFullSnapshot({ compact: true });
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length < 90000);
  await assert.rejects(native.pushNativeSnapshot(), /配额/);
  assert.equal(stats.sets, 0);
});

test('edits made during a conflicting upload are retained locally for the next push', async () => {
  seed();
  const payload = storage.captureFullSnapshot({ compact: true });
  payload.advancedState.workspaces[0].apps.push(app(2));
  payload.apps.push(app(2));
  setRemote(payload, 5);
  beforeSet = async () => {
    write('apps', [app(1), app(3)]);
  };
  const result = await native.pushNativeSnapshot();
  assert.equal(result.conflict, true);
  assert.ok(storage.readLegacyApps().some((value) => value.id === 3));
  assert.notEqual(stableSnapshotString(storage.captureFullSnapshot({ compact: true })), localStorage.getItem(HASH));
});

test('legacy incoming cloud apps and settings survive an advanced-state merge', () => {
  seed();
  const merged = mergeSnapshots(storage.captureFullSnapshot(), {
    apps: [app(2)], todos: [{ id: 2, text: 'legacy todo' }], searchEngine: 'google',
  });
  assert.ok(merged.apps.some((value) => value.id === 2));
  assert.ok(merged.advancedState.workspaces[0].apps.some((value) => value.id === 2));
  assert.ok(merged.todos.some((value) => value.text === 'legacy todo'));
  assert.equal(merged.searchEngine, 'google');
});

test('legacy local apps survive when merging a remote advanced snapshot', () => {
  seed();
  const merged = mergeSnapshots({ apps: [app(2)] }, storage.captureFullSnapshot());
  assert.ok(merged.apps.some((value) => value.id === 2));
});

test('empty partial payload does not alter the active workspace', () => {
  seed();
  const snapshot = storage.captureFullSnapshot();
  const merged = mergeSnapshots(snapshot, {});
  assert.deepEqual(merged.apps, snapshot.apps);
  assert.equal(merged.advancedState.activeWorkspaceId, snapshot.advancedState.activeWorkspaceId);
});

test('late chunk-only arrival triggers another automatic pull', async (t) => {
  seed();
  const payload = storage.captureFullSnapshot({ compact: true });
  payload.advancedState.workspaces[0].name = 'arrived later';
  setRemote(payload);
  const chunk = remote[`${CHUNK}0`];
  delete remote[`${CHUNK}0`];
  storage.setNativeSyncEnabled(true);
  const stop = native.initializeNativeSync();
  t.after(stop);
  await flush();
  remote[`${CHUNK}0`] = chunk;
  for (const listener of listeners) listener({ [`${CHUNK}0`]: { newValue: chunk } }, 'sync');
  for (const callback of timeouts.values()) callback();
  timeouts.clear();
  await flush();
  assert.equal(storage.getActiveWorkspace(storage.loadAdvancedState()).name, 'arrived later');
});
