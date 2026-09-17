import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as store from '../src/advanced/storage.js';
import { clone, entityKey, normalizeState, SCHEMA_VERSION } from '../src/advanced/workspaceModel.js';
import { mergeSnapshots, stableSnapshotString } from '../src/advanced/syncMerge.js';
globalThis.crypto ??= webcrypto;
globalThis.CustomEvent ??= class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } };
class MemoryStorage {
  values = new Map(); writes = [];
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.writes.push(k); this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}
const KEY = store.ADVANCED_KEYS.ADVANCED_STATE_KEY;
const app = (id) => ({ id, name: id, url: `https://example.test/${id}` });
const active = () => store.getActiveWorkspace(store.loadAdvancedState());
const setup = () => {
  localStorage.setItem('apps', JSON.stringify([app('a'), app('b')]));
  return store.initializeWorkspaceStore();
};
const branch = (snapshot, operation) => { store.applyFullSnapshot(snapshot, { selectWorkspace: true }); operation(); return store.captureFullSnapshot(); };
beforeEach(() => { globalThis.localStorage = new MemoryStorage(); globalThis.window = new EventTarget(); });

test('legacy scalar JSON damage is tolerated, empty apps and brightness zero survive initialization', () => {
  localStorage.setItem('todos', '{broken'); localStorage.setItem('componentSettings', 'null');
  localStorage.setItem('apps', '[]'); localStorage.setItem('backgroundBrightness', '0');
  store.initializeWorkspaceStore();
  assert.deepEqual(active().apps, []); assert.deepEqual(active().settings.todos, []);
  assert.equal(active().settings.backgroundBrightness, 0);
  assert.ok(localStorage.getItem(store.ADVANCED_KEYS.MIGRATION_BACKUP_KEY));
});
test('v3 membership migrates once, first folder wins and explicit root wins', () => {
  const old = { schemaVersion: 3, activeWorkspaceId: 'w', workspaces: [{ id: 'w', name: 'old', apps: [app('a'), { ...app('b'), folderId: null }], folders: [{ id: 'f', name: 'first', appIds: ['a','b'] }, { id: 'g', name: 'second', appIds: ['a'] }] }] };
  localStorage.setItem(KEY, JSON.stringify(old)); store.initializeWorkspaceStore();
  assert.equal(active().apps[0].folderId, 'f'); assert.equal(active().apps[1].folderId, null);
  assert.ok(active().folders.every((f) => !('appIds' in f)));
  assert.equal(JSON.parse(localStorage.getItem(store.ADVANCED_KEYS.MIGRATION_BACKUP_KEY)).rawState, JSON.stringify(old));
});
test('v4 foldered apps do not disappear due to a stale legacy root projection', () => {
  localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 4, activeWorkspaceId: 'w', workspaces: [{ id: 'w', apps: [{ ...app('a'), folderId:'f' }], folders: [{id:'f'}] }] }));
  localStorage.setItem('apps','[]'); store.initializeWorkspaceStore(); assert.equal(active().apps.length,1);
});
test('v5 is authoritative: later raw legacy writes cannot replace apps or settings', () => {
  setup(); const id=active().id; store.setWorkspaceSetting(id,'themeMode','dark');
  localStorage.setItem('apps','[]'); localStorage.setItem('themeMode','light');
  assert.equal(active().apps.length,2); assert.equal(active().settings.themeMode,'dark');
  store.addFolder(store.loadAdvancedState(),'folder');
  assert.equal(active().apps.length,2); assert.equal(active().settings.themeMode,'dark');
});
test('getSnapshot is cached and read-only after initialization', () => {
  const first=setup(); const writes=localStorage.writes.length;
  for(let i=0;i<10;i++) assert.equal(store.loadAdvancedState(),first);
  assert.equal(localStorage.writes.length,writes);
});
test('one failed authoritative write neither publishes nor loses current state', () => {
  const first=setup(); let published=0; const stop=store.subscribeWorkspaceStore(()=>published++);
  const set=localStorage.setItem.bind(localStorage); localStorage.setItem=(key,val)=>{ if(key===KEY) throw new Error('quota'); set(key,val); };
  assert.throws(()=>store.renameWorkspace(first,first.activeWorkspaceId,'renamed'),/quota/);
  assert.equal(store.loadAdvancedState(),first); assert.equal(published,0); stop();
});
test('malformed authoritative JSON and future schema fail closed without reset', () => {
  localStorage.setItem(KEY,'{broken'); const old=localStorage.getItem(KEY);
  assert.throws(()=>store.initializeWorkspaceStore(),/损坏/); assert.equal(localStorage.getItem(KEY),old);
  localStorage.setItem(KEY,JSON.stringify({schemaVersion:SCHEMA_VERSION+1,workspaces:[]}));
  assert.throws(()=>store.initializeWorkspaceStore(),/升级/);
});
test('blank scene is truly blank and independent; duplication is explicit and deep', () => {
  const initial=setup(); store.addFolder(initial,'dev'); const folder=active().folders[0].id;
  store.moveApps(active().id,['a'],folder); store.setWorkspaceSetting(active().id,'todos',[{id:'t',text:'task',completed:false}]);
  const source=clone(active()); store.addWorkspace(null,'blank');
  assert.deepEqual(active().apps,[]); assert.deepEqual(active().folders,[]); assert.deepEqual(active().settings.todos,[]);
  store.duplicateWorkspace(null,source.id); const copy=active();
  assert.notEqual(copy.id,source.id); assert.notEqual(copy.apps[0].id,source.apps[0].id);
  assert.notEqual(copy.folders[0].id,source.folders[0].id); assert.equal(copy.apps[0].folderId,copy.folders[0].id);
  assert.notEqual(copy.settings.todos[0].id,source.settings.todos[0].id);
  store.setWorkspaceSetting(copy.id,'themeMode','dark');
  assert.equal(store.loadAdvancedState().workspaces.find((w)=>w.id===source.id).settings.themeMode,'system');
});
test('latest-state actions retain another edit and delayed setters target original scene', () => {
  const old=setup(); const id=active().id;
  store.setWorkspaceSetting(id,'todos',[{id:'new',text:'new',completed:false}]);
  store.renameWorkspace(old,id,'renamed'); assert.equal(active().settings.todos.length,1);
  store.addWorkspace(null,'other'); store.setWorkspaceSetting(id,'backgroundImage','data:image/png;base64,test');
  assert.equal(active().settings.backgroundImage,'');
  assert.equal(store.loadAdvancedState().workspaces.find(w=>w.id===id).settings.backgroundImage,'data:image/png;base64,test');
});
test('switch changes only the active selection, not sync content', () => {
  const first=setup(); store.addWorkspace(null,'two'); const before=store.captureFullSnapshot();
  store.switchWorkspace(null,first.activeWorkspaceId); const after=store.captureFullSnapshot();
  assert.equal(stableSnapshotString(before),stableSnapshotString(after));
});
test('bulk move has one location; deleting folder returns apps to root', () => {
  setup();store.addFolder(null,'f'); const id=active().folders[0].id;
  store.moveApps(active().id,['a','b'],id); assert.equal(store.getRootApps(active()).length,0);
  store.deleteFolder(null,id); assert.equal(store.getRootApps(active()).length,2);
  assert.ok(store.loadAdvancedState().tombstones.folders[entityKey(active().id,id)]);
});
test('root editor cannot drop foldered apps, even when root list becomes empty', () => {
  setup();store.addFolder(null,'f');store.moveApps(active().id,['a'],active().folders[0].id);
  store.setWorkspaceApps(active().id,[],{rootOnly:true});
  assert.equal(active().apps.length,1);assert.equal(active().apps[0].id,'a');
  assert.ok(store.loadAdvancedState().tombstones.apps[entityKey(active().id,'b')]);
});
test('last scene cannot be deleted and stale target throws before writing', () => {
  setup();const before=localStorage.getItem(KEY);
  assert.throws(()=>store.deleteWorkspace(null,active().id),/至少/);
  assert.throws(()=>store.setWorkspaceSetting('gone','themeMode','dark'),/删除/);
  assert.equal(localStorage.getItem(KEY),before);
});
test('delete app undo remints ID and stale remote never resurrects deleted ID', () => {
  setup();const remote=store.captureFullSnapshot();const id=active().id;
  const undo=store.withUndo(()=>store.setWorkspaceApps(id,(apps)=>apps.filter(a=>a.id!=='a')));
  undo();assert.equal(active().apps.length,2);assert.ok(active().apps.every(a=>a.id!=='a'));
  const merged=mergeSnapshots(store.captureFullSnapshot(),remote);
  assert.ok(merged.advancedState.workspaces[0].apps.every(a=>a.id!=='a'));
  assert.equal(merged.advancedState.workspaces[0].apps.length,2);
});
test('delete folder undo restores membership using a new folder ID', () => {
  setup();store.addFolder(null,'f');const old=active().folders[0].id;store.moveApps(active().id,['a'],old);
  const undo=store.withUndo(()=>store.deleteFolder(null,old));undo();
  assert.notEqual(active().folders[0].id,old);assert.equal(active().apps[0].folderId,active().folders[0].id);
});
test('delete todo tombstone survives stale merge; undo remints todo ID', () => {
  setup();const id=active().id;store.setWorkspaceSetting(id,'todos',[{id:'t',text:'todo',completed:false}]);
  const before=store.captureFullSnapshot();const undo=store.withUndo(()=>store.setWorkspaceSetting(id,'todos',[]));
  let merged=mergeSnapshots(store.captureFullSnapshot(),before);assert.deepEqual(merged.advancedState.workspaces[0].settings.todos,[]);
  undo();assert.notEqual(active().settings.todos[0].id,'t');
});
test('stale undo is rejected after a later edit', () => {
  setup();const id=active().id;const undo=store.withUndo(()=>store.setWorkspaceApps(id,[]));
  store.setWorkspaceSetting(id,'themeMode','dark'); const before=localStorage.getItem(KEY);
  assert.throws(undo,/新的修改/);assert.equal(localStorage.getItem(KEY),before);
});
test('import keeps a recovery point and does not let old deleted scenes return from sync', () => {
  setup();const before=store.captureFullSnapshot();store.importFullSnapshot({apps:[app('imported')],todos:[]});
  assert.equal(active().apps[0].id.startsWith('app-'),true);
  assert.equal(store.getRecoveryPoint().state.activeWorkspaceId,before.advancedState.activeWorkspaceId);
  const merged=mergeSnapshots(store.captureFullSnapshot(),before);
  assert.equal(merged.advancedState.workspaces.length,1);
  store.restoreRecoveryPoint();assert.equal(active().apps.length,2);
});
test('invalid import is rejected before recovery point and state are touched', () => {
  setup();const before=localStorage.getItem(KEY);
  assert.throws(()=>store.importFullSnapshot({apps:null}),/格式/);
  assert.equal(store.getRecoveryPoint(),null);assert.equal(localStorage.getItem(KEY),before);
});
test('different settings and a workspace rename merge independently of later unrelated changes', () => {
  setup();const id=active().id;const base=store.captureFullSnapshot();
  const left=branch(base,()=>{store.renameWorkspace(null,id,'new name');store.setWorkspaceSetting(id,'themeMode','dark');});
  const right=branch(base,()=>{store.setWorkspaceSetting(id,'backgroundBlur',7);store.setWorkspaceSetting(id,'todos',[{id:'task',text:'later',completed:false}]);});
  const ws=mergeSnapshots(left,right).advancedState.workspaces[0];
  assert.equal(ws.name,'new name');assert.equal(ws.settings.themeMode,'dark');assert.equal(ws.settings.backgroundBlur,7);assert.equal(ws.settings.todos.length,1);
});
test('newer app location and URL edits are not reverted by a later unrelated settings edit', () => {
  setup();store.addFolder(null,'f');const id=active().id;const fid=active().folders[0].id;const base=store.captureFullSnapshot();
  const left=branch(base,()=>{store.moveApps(id,['a'],fid);store.setWorkspaceApps(id,(apps)=>apps.map(a=>a.id==='a'?{...a,url:'https://example.test/NewURL'}:a));});
  const right=branch(base,()=>store.setWorkspaceSetting(id,'themeMode','dark'));
  const ws=mergeSnapshots(left,right).advancedState.workspaces[0];assert.equal(ws.apps.length,2);
  assert.equal(ws.apps.find(a=>a.id==='a').folderId,fid);assert.equal(ws.apps.find(a=>a.id==='a').url,'https://example.test/NewURL');
});
test('Dock order survives a newer unrelated workspace change', () => {
  setup();const id=active().id;const base=store.captureFullSnapshot();
  const left=branch(base,()=>store.setWorkspaceApps(id,(apps)=>apps.reverse()));
  const right=branch(base,()=>store.setWorkspaceSetting(id,'themeMode','dark'));
  assert.deepEqual(mergeSnapshots(left,right).advancedState.workspaces[0].apps.map(a=>a.id),['b','a']);
});
test('compact snapshot omits local assets without repeatedly becoming dirty after application', () => {
  setup();store.setWorkspaceSetting(active().id,'backgroundImage','data:image/png;base64,local');
  const snapshot=store.captureFullSnapshot({compact:true});store.applyFullSnapshot(snapshot);
  assert.equal(active().settings.backgroundImage,'data:image/png;base64,local');
  assert.equal(stableSnapshotString(snapshot),stableSnapshotString(store.captureFullSnapshot({compact:true})));
});
test('storage notifications read current durable data and unsubscribe cleanly', () => {
  setup();let count=0;const stop=store.subscribeWorkspaceStore(()=>count++);
  const next=clone(store.loadAdvancedState());next.workspaces[0].name='another tab';localStorage.setItem(KEY,JSON.stringify(next));
  const event=new Event('storage');event.key=KEY;event.newValue='stale value';window.dispatchEvent(event);
  assert.equal(active().name,'another tab');assert.equal(count,1);stop();window.dispatchEvent(event);assert.equal(count,1);
});
test('concurrent deletion of all scenes fails closed instead of creating an empty authoritative state', () => {
  const first=setup();store.addWorkspace(null,'two');const second=active().id;const base=store.captureFullSnapshot();
  const left=branch(base,()=>store.deleteWorkspace(null,first.activeWorkspaceId));
  const right=branch(base,()=>store.deleteWorkspace(null,second));
  assert.throws(()=>mergeSnapshots(left,right),/冲突/);
});
