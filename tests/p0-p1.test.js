import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as store from '../src/advanced/storage.js';
import { normalizeState, clone, entityKey } from '../src/advanced/workspaceModel.js';
import * as history from '../src/advanced/recoveryHistory.js';
import * as organization from '../src/advanced/organization.js';
import * as sessions from '../src/advanced/browserSessions.js';
import * as diagnostics from '../src/advanced/syncDiagnostics.js';
import { diffSnapshots, previewSignature, preserveOmittedAssets } from '../src/advanced/snapshotDiff.js';
import { safeWebsiteUrl } from '../src/advanced/browserApi.js';
import { mergeSnapshots } from '../src/advanced/syncMerge.js';
import { getNativeSyncUsage } from '../src/advanced/nativeSync.js';

globalThis.crypto ??= webcrypto;
globalThis.CustomEvent ??= class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } };
class MemoryStorage {
  values = new Map(); fail = null; writes = [];
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) {
    if (this.fail?.(key, String(value))) throw new DOMException('simulated full storage', 'QuotaExceededError');
    this.values.set(key, String(value)); this.writes.push(key);
  }
  removeItem(key) { this.values.delete(key); }
}
const KEY = store.ADVANCED_KEYS.ADVANCED_STATE_KEY;
const at = '2026-09-20T00:00:00.000Z';
const app = (id, url = `https://example.com/${id}`, folderId = null) => ({ id, name: id, url, folderId, updatedAt: at });
const fixture = () => normalizeState({ schemaVersion: 5, activeWorkspaceId: 'one', updatedAt: at, workspaces: [
  { id: 'one', name: '工作', apps: [app('alpha'), app('beta')], folders: [], settings: { todos: [{ id: 't1', text: 'original', completed: false }] }, updatedAt: at },
  { id: 'two', name: '学习', apps: [], folders: [{ id: 'f2', name: '文档' }], settings: {}, updatedAt: at },
] });
let serial = 0; let calls; let currentTabs; let nextTab; let deny; let failUrl;
beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.window = new EventTarget();
  Object.assign(window, { setTimeout, clearTimeout, setInterval, clearInterval });
  globalThis.document = { visibilityState: 'visible' };
  localStorage.setItem(KEY, JSON.stringify(fixture()));
  localStorage.setItem(diagnostics.DIAGNOSTICS_KEY, JSON.stringify({ version: 1, scopes: {}, test: ++serial }));
  calls = []; currentTabs = [{ id: 1, windowId: 10, index: 0, url: 'https://already.example/', title: 'Existing', groupId: -1 }];
  nextTab = 100; deny = false; failUrl = '';
  const runtime = { id: 'test-extension' };
  globalThis.chrome = {
    runtime,
    permissions: { request: (value, callback) => { calls.push(['permissions', value]); callback(!deny); } },
    tabs: {
      query: (value, callback) => { calls.push(['query', value]); callback(clone(currentTabs)); },
      create: (value, callback) => {
        calls.push(['create', value]);
        if (value.url === failUrl) { runtime.lastError = { message: 'simulated tab failure' }; callback(); delete runtime.lastError; return; }
        const tab = { ...value, id: nextTab++, windowId: value.windowId || 10 }; currentTabs.push(tab); callback(tab);
      },
      update: (id, value, callback) => { calls.push(['update', id, value]); callback({ id, ...value }); },
      group: (value, callback) => { calls.push(['group', value]); callback(700); },
      remove: () => { throw new Error('Existing tabs must never be removed'); },
    },
    tabGroups: {
      get: (id, callback) => callback({ id, title: '开发', color: 'blue', collapsed: true }),
      update: (id, value, callback) => { calls.push(['groupUpdate', id, value]); callback({ id, ...value }); },
    },
    windows: { create: (value, callback) => { calls.push(['window', value]); const tab = { id: nextTab++, windowId: 20, url: value.url }; currentTabs.push(tab); callback({ id: 20, tabs: [tab] }); } },
    bookmarks: { getTree: (callback) => { calls.push(['bookmarks']); callback([{ title: '开发', children: [{ title: '文档', url: 'https://docs.example/' }] }]); } },
    storage: { sync: { QUOTA_BYTES: 102400, getBytesInUse: (_keys, cb) => cb(4567) } },
  };
});
const durable = () => localStorage.getItem(KEY);
const active = () => store.getActiveWorkspace(store.loadAdvancedState());

test('URL validation rejects internal schemes and embedded credentials but preserves path case', () => {
  for (const value of ['javascript:alert(1)', 'data:text/plain,x', 'file:///etc/hosts', 'chrome://settings', 'https://user:pass@example.com', null]) assert.equal(safeWebsiteUrl(value), null);
  assert.equal(safeWebsiteUrl(' HTTPS://EXAMPLE.COM:443/Case?q=UP '), 'https://example.com/Case?q=UP');
});
test('recovery history imports the old point once and does not resurrect it after deletion', () => {
  localStorage.setItem('navinocode_workspace_recovery', JSON.stringify({ state: fixture(), reason: '旧记录', createdAt: at }));
  assert.equal(history.readRecoveryHistory()[0].id, 'legacy-recovery');
  const point = store.saveRecoveryPoint('新记录');
  assert.equal(history.readRecoveryHistory().length, 2);
  history.deleteRecoveryRecord(point.id); history.deleteRecoveryRecord('legacy-recovery');
  assert.deepEqual(history.readRecoveryHistory(), []);
  assert.ok(localStorage.getItem('navinocode_workspace_recovery'));
});
test('recovery history bounds count and evicts the oldest, not the newest', () => {
  for (let i = 0; i < 25; i++) store.saveRecoveryPoint(`point-${i}`);
  const records = history.readRecoveryHistory(); assert.equal(records.length, 20);
  assert.equal(records[0].reason, 'point-24'); assert.equal(records[19].reason, 'point-5');
});
test('recovery byte budget prunes old full snapshots', () => {
  const state = fixture(); state.workspaces[0].settings.backgroundImage = 'x'.repeat(900000);
  for (let i = 0; i < 7; i++) history.saveRecoveryRecord(state, String(i));
  assert.ok(history.recoveryUsage().bytes <= history.HISTORY_BYTES);
  assert.ok(history.readRecoveryHistory().length < 7);
  assert.equal(history.readRecoveryHistory()[0].reason, '6');
});
test('oversized single recovery point leaves prior history intact', () => {
  store.saveRecoveryPoint('safe'); const raw = localStorage.getItem(history.RECOVERY_HISTORY_KEY);
  const state = fixture(); state.workspaces[0].settings.backgroundImage = 'x'.repeat(history.HISTORY_BYTES);
  assert.throws(() => history.saveRecoveryRecord(state), /4 MiB/);
  assert.equal(localStorage.getItem(history.RECOVERY_HISTORY_KEY), raw);
});
test('recovery quota retry retains newest record and a total failure keeps the previous record', () => {
  store.saveRecoveryPoint('old');
  localStorage.fail = (key, value) => key === history.RECOVERY_HISTORY_KEY && JSON.parse(value).entries.length > 1;
  store.saveRecoveryPoint('new'); assert.equal(history.readRecoveryHistory().length, 1);
  assert.equal(history.readRecoveryHistory()[0].reason, 'new');
  const old = localStorage.getItem(history.RECOVERY_HISTORY_KEY);
  localStorage.fail = (key) => key === history.RECOVERY_HISTORY_KEY;
  assert.throws(() => store.saveRecoveryPoint('fails'));
  assert.equal(localStorage.getItem(history.RECOVERY_HISTORY_KEY), old);
});
test('corrupt and future recovery records are not silently overwritten', () => {
  for (const raw of ['{broken', '{"version":99,"entries":[]}', '{"version":1,"entries":[{}]}']) {
    localStorage.setItem(history.RECOVERY_HISTORY_KEY, raw);
    assert.throws(() => store.saveRecoveryPoint('x'));
    assert.equal(localStorage.getItem(history.RECOVERY_HISTORY_KEY), raw);
  }
});
test('restoring a selected version retains its active workspace and remints identities', () => {
  store.switchWorkspace(null, 'two'); const point = store.saveRecoveryPoint('target');
  store.renameWorkspace(null, 'two', 'changed');
  const expectedSignature = previewSignature(store.captureFullSnapshot());
  store.restoreRecoveryPoint(point.id, { expectedSignature });
  const state = store.loadAdvancedState(); assert.equal(store.getActiveWorkspace(state).name, '学习');
  assert.ok(state.workspaces.every((ws) => !['one', 'two'].includes(ws.id)));
  assert.ok(state.tombstones.workspaces.one && state.tombstones.workspaces.two);
  assert.equal(history.readRecoveryHistory()[0].reason, '恢复前');
});
test('stale recovery preview fails before creating a new recovery point', () => {
  const point = store.saveRecoveryPoint('target'); const signature = previewSignature(store.captureFullSnapshot());
  store.renameWorkspace(null, 'one', 'new'); const saved = durable();
  assert.throws(() => store.restoreRecoveryPoint(point.id, { expectedSignature: signature }), /预览/);
  assert.equal(durable(), saved); assert.equal(history.readRecoveryHistory().length, 1);
});
test('failed recovery backup prevents import from replacing current state', () => {
  const old = durable(); localStorage.fail = (key) => key === history.RECOVERY_HISTORY_KEY;
  assert.throws(() => store.importFullSnapshot({ apps: [app('new')], todos: [] })); assert.equal(durable(), old);
});
test('diff ignores timestamps, shows settings/app fields/todos and bounds output', () => {
  const a = fixture(); const b = clone(a); b.updatedAt = '2030-01-01'; b.workspaces[0].apps[0].updatedAt = '2030-01-01';
  assert.equal(diffSnapshots(a, b).total, 0);
  b.workspaces[0].apps[0].iconBackground = 'custom'; b.workspaces[0].settings.todos[0].completed = true;
  b.workspaces[0].settings.backgroundImage = 'data:image/png;base64,' + 'X'.repeat(1000);
  const diff = diffSnapshots(a, b); assert.equal(diff.changed, 3);
  assert.ok(!JSON.stringify(diff).includes('X'.repeat(100)));
  assert.equal(diffSnapshots(a, b, 1).items.length, 1); assert.equal(diffSnapshots(a, b, 1).truncated, true);
});
test('compact snapshot asset omissions are preserved in normalized previews', () => {
  store.setWorkspaceSetting('one', 'backgroundImage', 'data:image/png;base64,local');
  const local = store.captureFullSnapshot(); const compact = store.captureFullSnapshot({ compact: true });
  const hydrated = preserveOmittedAssets(compact, local);
  assert.equal(diffSnapshots(local, hydrated).total, 0);
  compact.advancedState.workspaces[0].settings.backgroundImage = '';
  assert.equal(preserveOmittedAssets(compact, local).advancedState.workspaces[0].settings.backgroundImage, '');
});
test('cross-workspace move is one canonical write, leaves duplicates in source and tombstones moved IDs', () => {
  store.setWorkspaceApps('two', [app('duplicate', 'https://example.com/beta')]);
  const before = store.captureFullSnapshot(); localStorage.writes = [];
  const result = store.moveAppsAcrossWorkspaces('one', ['alpha', 'beta'], 'two', 'f2');
  assert.deepEqual(result, { moved: 1, skipped: 1 });
  assert.equal(localStorage.writes.filter((key) => key === KEY).length, 1);
  const state = store.loadAdvancedState(); assert.deepEqual(state.workspaces[0].apps.map((item) => item.id), ['beta']);
  const moved = state.workspaces[1].apps.find((item) => item.name === 'alpha'); assert.equal(moved.folderId, 'f2'); assert.notEqual(moved.id, 'alpha');
  assert.ok(state.tombstones.apps[entityKey('one', 'alpha')]);
  const merged = mergeSnapshots(before, store.captureFullSnapshot()); assert.ok(!merged.advancedState.workspaces[0].apps.some((item) => item.id === 'alpha'));
  store.moveAppsAcrossWorkspaces('two', [moved.id], 'one'); assert.equal(active().apps.length, 2);
});
test('move explicit duplicate preservation and stale preview/target checks', () => {
  store.setWorkspaceApps('two', [app('duplicate', 'https://example.com/alpha')]);
  const signature = previewSignature(store.loadAdvancedState());
  store.renameWorkspace(null, 'two', 'new'); const old = durable();
  assert.throws(() => store.moveAppsAcrossWorkspaces('one', ['alpha'], 'two', null, { expectedSignature: signature }), /预览/);
  assert.throws(() => store.moveAppsAcrossWorkspaces('one', ['alpha'], 'two', 'missing'), /文件夹/); assert.equal(durable(), old);
  assert.equal(store.moveAppsAcrossWorkspaces('one', ['alpha'], 'two', null, { duplicatePolicy: 'keep' }).moved, 1);
  assert.equal(store.loadAdvancedState().workspaces[1].apps.length, 2);
});
test('failed canonical bulk move leaves both workspaces unchanged', () => {
  const old = durable(); localStorage.fail = (key) => key === KEY;
  assert.throws(() => store.moveAppsAcrossWorkspaces('one', ['alpha'], 'two')); assert.equal(durable(), old);
  assert.equal(history.readRecoveryHistory().length, 1);
});
test('bookmark tree preview separates existing/input duplicates and unsafe URLs', () => {
  const rows = organization.flattenBookmarkTree([{ title: '开发', children: [
    { title: 'existing', url: 'https://example.com/alpha' }, { title: 'new', url: 'https://EXAMPLE.COM/Case' },
    { title: 'duplicate', url: 'https://example.com/Case' }, { title: 'different', url: 'https://example.com/case' }, { title: 'unsafe', url: 'javascript:alert(1)' },
  ] }]);
  const preview = organization.previewBookmarkImport(store.loadAdvancedState(), 'one', rows);
  assert.deepEqual(preview.map((row) => row.status), ['duplicate', 'new', 'duplicate', 'new', 'invalid']);
  assert.equal(preview[1].destination, '开发');
});
test('bookmark import preserves paths as single-level folders and never mutates the source browser', () => {
  const rows = organization.parseBookmarkFile(JSON.stringify([{ title: 'A', children: [{ title: 'B', children: [{ title: 'new', url: 'https://new.example/' }] }] }]));
  assert.deepEqual(rows[0].path, ['A', 'B']);
  const result = store.importBookmarkRows('two', rows);
  assert.deepEqual(result, { imported: 1, skipped: 0 });
  const ws = store.loadAdvancedState().workspaces[1]; assert.ok(ws.folders.some((folder) => folder.name === 'A / B'));
  assert.ok(ws.apps[0].folderId); assert.equal(calls.length, 0);
});
test('bookmark explicit target folder wins over paths, duplicate imports do not create empty folders', () => {
  const rows = [{ title: 'new', url: 'https://new.example/', path: ['Unused'] }];
  store.importBookmarkRows('two', rows, { folderId: 'f2' });
  const result = store.importBookmarkRows('two', rows);
  assert.equal(result.imported, 0); assert.equal(store.loadAdvancedState().workspaces[1].folders.length, 1);
});
test('bookmark file, node, depth and batch limits fail before state writes', () => {
  assert.throws(() => organization.parseBookmarkFile('{bad'), /有效/);
  assert.throws(() => organization.parseBookmarkFile('x'.repeat(organization.IMPORT_FILE_BYTES + 1)), /2 MiB/);
  assert.throws(() => organization.flattenBookmarkTree([{ children: 'bad' }]), /子节点/);
  let tree = { children: [] }; for (let i = 0; i < 35; i++) tree = { children: [tree] };
  assert.throws(() => organization.flattenBookmarkTree([tree]), /层级/);
  const old = durable(); assert.throws(() => store.importBookmarkRows('one', Array(1001).fill({ url: 'https://example.com' }))); assert.equal(durable(), old);
});
test('browser bookmark reading requests only bookmarks and denial reads nothing', async () => {
  deny = true; await assert.rejects(organization.readBrowserBookmarks(), /未授予/);
  assert.deepEqual(calls.map(([name]) => name), ['permissions']);
  deny = false; calls.length = 0; const rows = await organization.readBrowserBookmarks();
  assert.deepEqual(calls[0], ['permissions', { permissions: ['bookmarks'] }]); assert.equal(rows[0].title, '文档');
});
test('session normalization deduplicates, excludes private/internal URLs and preserves group/pin data', () => {
  const result = sessions.normalizeSessionTabs([
    { url: 'https://example.com/A', title: 'A', pinned: true, group: { id: 'g', title: 'Dev', color: 'blue' } },
    { url: 'https://EXAMPLE.COM/A' }, { url: 'chrome://newtab' }, { url: 'https://private.example/', incognito: true }, { url: 'https://example.com/a' },
  ]);
  assert.equal(result.duplicates, 1); assert.equal(result.excluded, 2); assert.equal(result.tabs.length, 2);
  assert.equal(result.tabs[0].pinned, true); assert.equal(result.tabs[0].group.title, 'Dev');
});
test('session capture is current-window scoped, permission-controlled and read-only', async () => {
  currentTabs.push({ id: 2, windowId: 10, url: 'https://docs.example/', title: 'Docs', index: 1, groupId: 5 });
  const preview = await sessions.captureCurrentWindow();
  assert.deepEqual(calls[0][1].permissions, ['tabs', 'tabGroups']); assert.deepEqual(calls[1], ['query', { currentWindow: true }]);
  assert.equal(preview.tabs[1].group.title, '开发'); assert.equal(localStorage.getItem(sessions.SESSION_KEY), null);
});
test('private window and denied session permissions do not read or save private tabs', async () => {
  deny = true; await assert.rejects(sessions.captureCurrentWindow(), /未授予/); assert.equal(calls.length, 1);
  deny = false; currentTabs[0].incognito = true;
  await assert.rejects(sessions.captureCurrentWindow(), /隐私/);
  await assert.rejects(sessions.previewSessionRestore({ tabs: [] }), /隐私/);
  assert.equal(localStorage.getItem(sessions.SESSION_KEY), null);
});
test('session capacity does not silently evict an older user session', () => {
  for (let i = 0; i < 20; i++) sessions.saveSession(`name-${i}`, [{ url: 'https://example.com/' }]);
  const raw = localStorage.getItem(sessions.SESSION_KEY);
  assert.throws(() => sessions.saveSession('extra', [{ url: 'https://example.com/' }]), /上限/);
  assert.equal(localStorage.getItem(sessions.SESSION_KEY), raw);
  assert.throws(() => sessions.saveSession('too many', Array.from({ length: 251 }, (_, i) => ({ url: `https://example.com/${i}` }))), /250/);
});
test('session restore skips existing URLs and never touches existing tab IDs', async () => {
  const session = sessions.saveSession('Work', [{ url: 'https://already.example/' }, { url: 'https://new.example/', pinned: true }, { url: 'https://group.example/' }]);
  const first = await sessions.restoreSession(session); assert.equal(first.opened.length, 2); assert.equal(first.skipped, 1);
  assert.ok(calls.filter(([name]) => name === 'group').every(([, value]) => value.tabIds.every((id) => id >= 100)));
  const second = await sessions.restoreSession(session); assert.equal(second.opened.length, 0); assert.equal(second.skipped, 3);
  assert.equal(calls.filter(([name]) => name === 'update').length, 0);
});
test('partial tab failure is reported and retry deduplicates successful opens', async () => {
  const session = sessions.saveSession('partial', [{ url: 'https://ok.example/' }, { url: 'https://fail.example/' }]);
  failUrl = 'https://fail.example/'; const first = await sessions.restoreSession(session, { group: false });
  assert.equal(first.opened.length, 1); assert.equal(first.failed.length, 1);
  failUrl = ''; const second = await sessions.restoreSession(session, { group: false }); assert.equal(second.opened.length, 1); assert.equal(second.skipped, 1);
});
test('new-window restoration pins only new tabs, and cancellation stops future creates', async () => {
  const session = sessions.saveSession('new', [{ url: 'https://new.example/', pinned: true }]);
  const result = await sessions.restoreSession(session, { target: 'new', group: false }); assert.equal(result.newWindowId, 20);
  assert.deepEqual(calls.find(([name]) => name === 'update').slice(1), [100, { pinned: true }]);
  const controller = new AbortController(); controller.abort(); calls.length = 0;
  const cancelled = await sessions.restoreSession({ name: 'x', tabs: [{ url: 'https://other.example/' }] }, { signal: controller.signal });
  assert.equal(cancelled.cancelled, true); assert.ok(!calls.some(([name]) => ['create', 'window', 'group'].includes(name)));
});
test('group failure does not misreport already opened tabs as failed or reopen them', async () => {
  chrome.tabs.group = (_value, callback) => { chrome.runtime.lastError = { message: 'group failed' }; callback(); delete chrome.runtime.lastError; };
  const result = await sessions.restoreSession({ name: 'g', tabs: [{ url: 'https://g.example/' }] });
  assert.equal(result.opened.length, 1); assert.equal(result.failed.length, 0); assert.equal(result.groupErrors.length, 1);
});
test('Web mode reports unsupported sessions and browser usage instead of fake success', async () => {
  delete globalThis.chrome; await assert.rejects(sessions.captureCurrentWindow(), /扩展/); await assert.rejects(getNativeSyncUsage(), /扩展/);
});
test('diagnostic scopes include URL/table/sync ID, never anon key', () => {
  const config = { url: 'https://one.supabase.co', anonKey: 'secret' };
  const scope = diagnostics.cloudDiagnosticScope(config, 'table', 'id');
  assert.equal(scope, diagnostics.cloudDiagnosticScope({ ...config, anonKey: 'other' }, 'table', 'id'));
  assert.notEqual(scope, diagnostics.cloudDiagnosticScope({ url: 'https://two.supabase.co' }, 'table', 'id'));
  assert.notEqual(scope, diagnostics.cloudDiagnosticScope(config, 'other', 'id'));
  assert.notEqual(scope, diagnostics.cloudDiagnosticScope(config, 'table', 'other'));
  assert.ok(!scope.includes('one.supabase'));
});
test('diagnostics distinguish preview reads from acknowledged sync and retain actual remote fingerprint', async () => {
  const remote = store.captureFullSnapshot();
  await diagnostics.observeSync('browser', 'browser', 'preview', async () => ({ found: true, payload: remote }));
  assert.equal(diagnostics.getSyncDiagnostics('browser').lastSuccess, undefined);
  assert.equal(diagnostics.getSyncDiagnostics('browser').acknowledgedFingerprint, undefined);
  store.renameWorkspace(null, 'one', 'local edit');
  await diagnostics.observeSync('browser', 'browser', 'pull', async () => ({ payload: store.captureFullSnapshot(), acknowledgedPayload: remote, merged: true }));
  assert.equal(diagnostics.getSyncDiagnostics('browser').acknowledgedFingerprint, await diagnostics.snapshotFingerprint(remote));
  assert.notEqual(diagnostics.getSyncDiagnostics('browser').acknowledgedFingerprint, await diagnostics.snapshotFingerprint(store.captureFullSnapshot()));
});
test('diagnostic errors redact known credentials, addresses and tokens; history is bounded', async () => {
  const secret = 'opaque-custom-credential';
  await assert.rejects(diagnostics.observeSync('x', 'supabase', 'push', async () => { throw new Error(`https://server.example/path?secret=x ${secret} token=hidden eyJabc.defghi.xyz`); }, [secret]));
  const error = JSON.stringify(diagnostics.exportSyncDiagnostics('x'));
  for (const value of ['server.example', secret, 'eyJabc.defghi.xyz', 'token=hidden']) assert.ok(!error.includes(value));
  for (let i = 0; i < 35; i++) await diagnostics.observeSync('x', 'supabase', 'preview', async () => ({ found: false }));
  assert.equal(diagnostics.getSyncDiagnostics('x').events.length, 30);
});
test('malformed diagnostics and quota errors cannot fail a successful operation', async () => {
  localStorage.setItem(diagnostics.DIAGNOSTICS_KEY, JSON.stringify({ version: 1, scopes: { bad: null, list: [], wrong: { events: [null] } } }));
  localStorage.fail = (key) => key === diagnostics.DIAGNOSTICS_KEY;
  const result = await diagnostics.observeSync('browser', 'browser', 'push', async () => ({ revision: 1 }));
  assert.equal(result.revision, 1); assert.equal(diagnostics.getSyncDiagnostics('browser').lastResult, 'success');
  assert.equal(diagnostics.getSyncDiagnostics('browser').volatile, true);
});
test('native quota displays API bytes rather than estimating payload length', async () => {
  assert.deepEqual(await getNativeSyncUsage(), { used: 4567, limit: 102400 });
});

// Execute the actual cloud adapter source. Only imports are adapted for Node's
// zero-dependency test job; the Supabase transport itself is a test double.
const moduleUrl = (relative) => new URL(relative, import.meta.url).href;
let cloudSource = readFileSync(new URL('../src/lib/cloudSync.js', import.meta.url), 'utf8')
  .replace(/import \{ createSupabaseClient, getSupabaseClientId \} from [^;]+;/,
    'const createSupabaseClient = (config) => globalThis.__testSupabaseFactory(config); const getSupabaseClientId = () => "test-id";');
for (const [name, file] of [['storage', 'storage.js'], ['syncMerge', 'syncMerge.js'], ['syncDiagnostics', 'syncDiagnostics.js']]) {
  cloudSource = cloudSource.replace(`"@/advanced/${name}"`, JSON.stringify(moduleUrl(`../src/advanced/${file}`)));
}
const cloudUrl = `data:text/javascript;base64,${Buffer.from(cloudSource).toString('base64')}`;
const cloud = await import(cloudUrl);
let previewSource = readFileSync(new URL('../src/advanced/syncPreview.js', import.meta.url), 'utf8');
previewSource = previewSource.replace("'../lib/cloudSync.js'", JSON.stringify(cloudUrl));
for (const name of ['storage.js', 'syncMerge.js', 'nativeSync.js', 'syncDiagnostics.js', 'snapshotDiff.js']) previewSource = previewSource.replace(`'./${name}'`, JSON.stringify(moduleUrl(`../src/advanced/${name}`)));
const syncPreview = await import(`data:text/javascript;base64,${Buffer.from(previewSource).toString('base64')}`);
const config = { url: 'https://test.supabase.co', anonKey: 'known-private-key' };
const cloudFixture = () => {
  const remote = { row: null, writes: 0, failRead: false };
  globalThis.__testSupabaseFactory = () => ({ from: () => ({
    select: () => { const q = { eq: () => q, abortSignal: () => q, maybeSingle: async () => ({ data: clone(remote.row), error: remote.failRead ? new Error('known-private-key https://test.supabase.co') : null }) }; return q; },
    upsert: (row) => { remote.row = clone(row); remote.writes++; return Promise.resolve({ error: null }); },
  }) });
  return remote;
};
const remotePayload = () => { const value = store.captureFullSnapshot(); value.advancedState.workspaces[0].apps.push(app('remote')); return value; };
const remoteRow = (payload, revision = 3, deviceId = 'remote') => ({ data: { __navinocodeSync: 2, revision, deviceId, updatedAt: at, payload }, updated_at: at });
test('cloud preview is read-only and strict about malformed envelope versions', async () => {
  const remote = cloudFixture(); remote.row = remoteRow(remotePayload()); const old = durable();
  const result = await cloud.readCloudSnapshot(config, undefined, 'id'); assert.equal(result.revision, 3);
  assert.equal(durable(), old); assert.equal(history.readRecoveryHistory().length, 0);
  remote.row.data.__navinocodeSync = 99; await assert.rejects(cloud.readCloudSnapshot(config, undefined, 'id'), /版本/);
});
test('cloud download acknowledges only after applying and backup failure leaves no false success', async () => {
  const remote = cloudFixture(); remote.row = remoteRow(remotePayload()); const old = durable();
  localStorage.fail = (key) => key === history.RECOVERY_HISTORY_KEY;
  await assert.rejects(cloud.pullCloudState(config, undefined, 'id'));
  assert.equal(durable(), old);
  const info = diagnostics.getSyncDiagnostics(diagnostics.cloudDiagnosticScope(config, undefined, 'id'));
  assert.equal(info.lastSuccess, undefined); assert.equal(info.lastResult, 'error');
  localStorage.fail = null; await cloud.pullCloudState(config, undefined, 'id');
  assert.ok(active().apps.some((item) => item.id === 'remote'));
});
test('cloud uploads retain unacknowledged remote edits even from the same device', async () => {
  const remote = cloudFixture(); remote.row = remoteRow(remotePayload(), 5, store.getDeviceId());
  const result = await cloud.pushCloudState(config, undefined, undefined, 'id');
  assert.equal(result.conflict, true); assert.equal(result.revision, 6);
  assert.ok(remote.row.data.payload.advancedState.workspaces[0].apps.some((item) => item.id === 'remote'));
  const pair = await Promise.all([cloud.pushCloudState(config, undefined, undefined, 'id'), cloud.pushCloudState(config, undefined, undefined, 'id')]);
  assert.equal(pair[1].revision, pair[0].revision + 1);
});
test('cloud abort and failure redact credentials in persistent diagnostics', async () => {
  const remote = cloudFixture(); const controller = new AbortController(); controller.abort();
  await assert.rejects(cloud.pushCloudState(config, undefined, undefined, 'id', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(remote.writes, 0);
  remote.failRead = true; await assert.rejects(cloud.pullCloudState(config, undefined, 'id'));
  const record = localStorage.getItem(diagnostics.DIAGNOSTICS_KEY); assert.ok(!record.includes(config.anonKey)); assert.ok(!record.includes(config.url));
});
test('sync difference confirmation rejects local and remote changes after preview', async () => {
  const remote = cloudFixture(); remote.row = remoteRow(remotePayload());
  const preview = await syncPreview.prepareSyncPreview('supabase', config, 'id');
  const old = durable(); assert.equal(history.readRecoveryHistory().length, 0);
  remote.row.data.payload.advancedState.workspaces[0].name = 'remote changed';
  await assert.rejects(syncPreview.applySyncPreview(preview, 'merge', config, 'id'), /云端/); assert.equal(durable(), old);
  const fresh = await syncPreview.prepareSyncPreview('supabase', config, 'id');
  store.renameWorkspace(null, 'one', 'local changed');
  await assert.rejects(syncPreview.applySyncPreview(fresh, 'replace', config, 'id'), /本地/);
});
test('confirmed sync replacement saves history, remints IDs, and does not upload', async () => {
  const remote = cloudFixture(); remote.row = remoteRow(remotePayload());
  const preview = await syncPreview.prepareSyncPreview('supabase', config, 'id');
  await syncPreview.applySyncPreview(preview, 'replace', config, 'id');
  assert.equal(remote.writes, 0); assert.equal(history.readRecoveryHistory().length, 1);
  assert.ok(store.loadAdvancedState().workspaces.every((ws) => !['one', 'two'].includes(ws.id)));
});
