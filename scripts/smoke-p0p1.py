"""Production-bundle Chromium smoke tests. Real DOM/localStorage, mocked extension APIs.
Run after npm run build. Requires playwright==1.55.0 and its Chromium browser.
"""
from pathlib import Path
import json, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'qa-output'
OUT.mkdir(exist_ok=True)
BASE = 'http://127.0.0.1:4173'
KEY = 'navinocode_advanced_state'
AT = '2026-09-20T00:00:00.000Z'
state = {'schemaVersion': 5, 'activeWorkspaceId': 'one', 'updatedAt': AT, 'workspaces': [
    {'id': 'one', 'name': '工作', 'apps': [
        {'id': 'alpha', 'name': 'Alpha', 'url': 'https://example.com/alpha', 'folderId': None},
        {'id': 'beta', 'name': 'Beta', 'url': 'https://example.com/beta', 'folderId': None}],
     'folders': [], 'settings': {}, 'updatedAt': AT},
    {'id': 'two', 'name': '学习', 'apps': [{'id': 'duplicate', 'name': 'Existing Beta', 'url': 'https://example.com/beta', 'folderId': None}],
     'folders': [{'id': 'f2', 'name': '文档'}], 'settings': {}, 'updatedAt': AT}]}
INIT = r'''
(() => {
  if (!localStorage.getItem('navinocode_advanced_state')) {
    localStorage.setItem('navinocode_advanced_state', __STATE__);
    localStorage.setItem('autoSyncEnabled', 'false');
    localStorage.setItem('navinocode_native_sync_enabled', 'false');
  }
  window.__ops = []; window.__syncData = {}; window.__syncListeners = new Set();
  window.__failGet = false; window.__failTabUrl = '';
  window.__tabs = [
    {id: 1, windowId: 10, index: 0, url: 'https://already.example/', title: 'Existing', pinned: true, groupId: -1},
    {id: 2, windowId: 10, index: 1, url: 'https://docs.example/', title: 'Docs', groupId: 5},
    {id: 3, windowId: 10, index: 2, url: 'https://already.example/', title: 'Duplicate', groupId: -1},
    {id: 4, windowId: 10, index: 3, url: 'chrome://newtab/', title: 'Internal', groupId: -1}
  ];
  let nextTab = 100; const granted = new Set(); const runtime = {id: 'smoke-extension'};
  const callback = (fn, value) => queueMicrotask(() => fn(structuredClone(value)));
  const fake = {runtime,
    permissions: {
      request: (value, cb) => { __ops.push(['permissions', value]); value.permissions.forEach(x => granted.add(x)); callback(cb, true); },
      contains: (value, cb) => callback(cb, value.permissions.every(x => granted.has(x)))
    },
    tabs: {
      query: (value, cb) => { __ops.push(['query', value]); callback(cb, value.currentWindow ? __tabs.filter(tab => tab.windowId === 10) : __tabs); },
      create: (value, cb) => { __ops.push(['create', value]); if (value.url === __failTabUrl) { queueMicrotask(()=>{runtime.lastError={message:'simulated tab failure'};cb();delete runtime.lastError;});return; } const tab = {...value,id:nextTab++,windowId:value.windowId||10}; __tabs.push(tab); callback(cb,tab); },
      update: (id,value,cb) => { __ops.push(['update',id,value]); callback(cb,{id,...value}); },
      group: (value,cb) => { __ops.push(['group',value]); callback(cb,500); },
      remove: () => { throw new Error('Smoke: existing tabs must not be closed'); }
    },
    windows: { create: (value,cb) => { __ops.push(['window',value]); const tab={id:nextTab++,windowId:20,url:value.url}; __tabs.push(tab); callback(cb,{id:20,tabs:[tab]}); } },
    tabGroups: { get: (id,cb) => callback(cb,{id,title:'开发',color:'blue',collapsed:false}), update: (id,value,cb) => { __ops.push(['groupUpdate',id,value]); callback(cb,{id,...value}); } },
    bookmarks: { getTree: cb => callback(cb,[{title:'Browser',children:[{title:'Browser Docs',url:'https://browser-docs.example/'}]}]), search: (_query,cb)=>callback(cb,[]) },
    history: { search: (_query,cb)=>callback(cb,[]) }, topSites: { get: cb=>callback(cb,[]) },
    storage: { sync: {
      QUOTA_BYTES:102400,
      get: (keys,cb) => { if (__failGet) { queueMicrotask(()=>{runtime.lastError={message:'simulated offline'};cb();delete runtime.lastError;});return; } const selected=typeof keys==='string'?[keys]:keys||Object.keys(__syncData); callback(cb,Object.fromEntries(selected.filter(k=>k in __syncData).map(k=>[k,__syncData[k]]))); },
      set: (values,cb) => { Object.assign(__syncData,structuredClone(values)); callback(cb,undefined); },
      remove: (keys,cb) => { keys.forEach(k=>delete __syncData[k]);callback(cb,undefined); },
      getBytesInUse: (_keys,cb) => callback(cb,new TextEncoder().encode(JSON.stringify(__syncData)).length)
    }, onChanged:{addListener:fn=>__syncListeners.add(fn),removeListener:fn=>__syncListeners.delete(fn)} }
  };
  Object.defineProperty(window,'chrome',{value:fake,configurable:true});
})();
'''.replace('__STATE__', json.dumps(json.dumps(state, ensure_ascii=False)))

results=[]
def passed(name):
    results.append(name)
    print('PASS', name, flush=True)
def durable(page): return page.evaluate('(key)=>JSON.parse(localStorage.getItem(key))', KEY)
def rename_from_other(page, name):
    page.evaluate('''({key,name})=>{const s=JSON.parse(localStorage.getItem(key));s.workspaces[0].name=name;s.workspaces[0].nameUpdatedAt='2030-01-01T00:00:00.000Z';s.workspaces[0].updatedAt=s.workspaces[0].nameUpdatedAt;s.updatedAt=s.workspaces[0].updatedAt;localStorage.setItem(key,JSON.stringify(s));}''', {'key':KEY,'name':name})
def open_settings(page):
    page.get_by_role('button', name='打开设置', exact=True).click()
    dialog=page.get_by_role('dialog',name='设置',exact=True)
    dialog.get_by_role('button',name='数据',exact=True).click()
    return dialog

def context_for(browser, width=1280):
    context=browser.new_context(viewport={'width':width,'height':900})
    context.add_init_script(INIT)
    def route_handler(route):
        url=route.request.url
        if url.startswith(BASE): route.continue_()
        elif 'v1.hitokoto.cn' in url: route.fulfill(json={'hitokoto':'Smoke test'})
        elif 'api.github.com' in url: route.fulfill(json={'stargazers_count':1})
        else: route.abort()
    context.route('**/*', route_handler)
    return context

server_log=(OUT/'server.log').open('w')
server=subprocess.Popen([sys.executable,'-m','http.server','4173','--bind','127.0.0.1','--directory',str(ROOT/'build')],stdout=server_log,stderr=subprocess.STDOUT)
try:
    for _ in range(100):
        try:
            urllib.request.urlopen(BASE,timeout=1).close();break
        except Exception: time.sleep(.1)
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        context=context_for(browser); page=context.new_page(); errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(BASE); page.get_by_role('button',name='整理网站',exact=True).first.click()
        library=page.get_by_role('dialog',name='整理网站',exact=True)
        library.get_by_role('checkbox',name='选择 Alpha',exact=True).check()
        library.get_by_role('button',name='跨工作区移动（1）',exact=True).click()
        move=page.get_by_role('dialog',name='跨工作区批量移动',exact=True)
        move.get_by_label('移动目标工作区',exact=True).select_option('two')
        move.get_by_label('移动目标文件夹',exact=True).select_option('f2')
        move.get_by_role('checkbox',name='我已检查移动目标与跳过项').check()
        move.get_by_role('button',name='确认移动网站',exact=True).click()
        page.wait_for_function("JSON.parse(localStorage.getItem('navinocode_advanced_state')).workspaces[1].apps.some(a=>a.name==='Alpha'&&a.folderId==='f2')")
        assert not any(a['id']=='alpha' for a in durable(page)['workspaces'][0]['apps'])
        passed('cross-workspace move updates both sides and target folder')
        library.get_by_role('checkbox',name='选择 Beta',exact=True).check()
        library.get_by_role('button',name='跨工作区移动（1）',exact=True).click()
        expect(move.get_by_role('button',name='确认移动网站',exact=True)).to_be_disabled()
        expect(move.get_by_text('将移动 0 个',exact=False)).to_be_visible()
        move.get_by_role('button',name='取消',exact=True).click()
        passed('duplicate move remains in source with disabled destructive confirmation')
        library.get_by_role('button',name='导入书签',exact=True).focus(); page.keyboard.press('Space')
        importer=page.get_by_role('dialog',name='书签导入预览',exact=True);expect(importer).to_be_visible()
        passed('Space activates focused action instead of stealing focus into search')
        importer.get_by_label('导入目标工作区',exact=True).select_option('two')
        html='''<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Bookmarks</TITLE><DL><p><DT><H3>Dev</H3><DL><p>
<DT><A HREF="https://new.example/Doc">Doc</A>
<DT><A HREF="https://NEW.example/Doc">Duplicate Doc</A>
<DT><A HREF="https://new.example/doc">Lowercase Doc</A>
<DT><A HREF="https://example.com/beta">Existing Beta</A>
<DT><A HREF="javascript:alert(1)">Unsafe</A></DL><p></DL><p><script>window.__importInjected=true</script>'''
        importer.get_by_label('导入书签文件',exact=True).set_input_files({'name':'bookmarks.html','mimeType':'text/html','buffer':html.encode()})
        expect(importer.get_by_text('可导入 2 条',exact=False)).to_be_visible()
        doc=importer.get_by_label('导入 Doc',exact=True);doc.focus();page.keyboard.press('Space');expect(doc).not_to_be_checked();page.keyboard.press('Space');expect(doc).to_be_checked()
        importer.get_by_role('button',name='导入选中 2 条书签',exact=True).click()
        ws=durable(page)['workspaces'][1]
        assert sum(a['url'].startswith('https://new.example/') for a in ws['apps'])==2
        assert any(f['name']=='Dev' for f in ws['folders'])
        assert page.evaluate('window.__importInjected === undefined')
        passed('inert Netscape HTML import preserves folder, previews duplicates, rejects script URLs')
        expect(importer).not_to_be_visible()
        page.screenshot(animations='disabled',path=str(OUT/'organizer-desktop.png'),full_page=True)
        library.get_by_role('button',name='Close',exact=True).click()
        expect(library).not_to_be_visible()
        open_settings(page)
        history=page.get_by_role('region',name='工作区恢复历史',exact=True)
        history.get_by_label('恢复点备注',exact=True).fill('Before rename')
        history.get_by_role('button',name='创建恢复点',exact=True).click()
        other=context.new_page();other.goto(BASE)
        rename_from_other(other,'First edit')
        page.wait_for_function("JSON.parse(localStorage.getItem('navinocode_advanced_state')).workspaces[0].name==='First edit'")
        history.get_by_role('button',name='预览恢复',exact=True).first.click()
        restore=page.get_by_role('dialog',name='恢复前差异预览',exact=True)
        restore.locator('[data-testid="snapshot-diff"] summary').first.click()
        expect(restore.get_by_text('First edit',exact=False).first).to_be_visible()
        rename_from_other(other,'Second edit')
        restore.get_by_role('checkbox').check();restore.get_by_role('button',name='确认恢复此版本',exact=True).click()
        expect(page.get_by_text('预览后本地配置已变化，请刷新预览再确认',exact=False).first).to_be_visible()
        restore.get_by_role('button',name='取消',exact=True).click()
        history.get_by_role('button',name='预览恢复',exact=True).first.click()
        restore.get_by_role('checkbox').check()
        restore.locator('[data-testid="snapshot-diff"] summary').first.click()
        page.screenshot(animations='disabled',path=str(OUT/'recovery-diff.png'),full_page=True)
        restore.get_by_role('button',name='确认恢复此版本',exact=True).click()
        expect(restore).not_to_be_visible()
        assert durable(page)['workspaces'][0]['name']=='工作'
        assert durable(page)['workspaces'][0]['id']!='one'
        other.close()
        passed('real storage event invalidates stale recovery preview; selected version restores safely')
        # Populate a remote compact snapshot; API is a transport double, not a real account.
        page.evaluate('''()=>{
 const s=JSON.parse(localStorage.getItem('navinocode_advanced_state')); s.workspaces[0].name='云端工作'; s.workspaces[0].nameUpdatedAt='2031-01-01T00:00:00.000Z'; s.workspaces[0].updatedAt=s.workspaces[0].nameUpdatedAt; s.updatedAt=s.workspaces[0].updatedAt;
 s.workspaces.forEach(ws=>{delete ws.settings.backgroundImage;ws.apps.forEach(a=>{if(String(a.icon||'').startsWith('data:'))delete a.icon;});});
 const active=s.workspaces.find(ws=>ws.id===s.activeWorkspaceId);const payload={...active.settings,apps:active.apps.filter(a=>!a.folderId),advancedState:s};
 const envelope={version:1,revision:3,deviceId:'remote-device',updatedAt:'2031-01-01T00:00:00.000Z',payload};const text=JSON.stringify(envelope),chunks=[];for(let i=0;i<text.length;i+=1800)chunks.push(text.slice(i,i+1800));
 __syncData={navinocode_sync_meta:{version:1,revision:3,deviceId:envelope.deviceId,updatedAt:envelope.updatedAt,chunks:chunks.length}};chunks.forEach((chunk,i)=>__syncData['navinocode_sync_chunk_'+i]=chunk);
}''')
        native=page.get_by_role('region',name='浏览器同步诊断',exact=True)
        native.get_by_role('button',name='预览远端差异',exact=True).click()
        sync=page.get_by_role('dialog',name='同步差异预览',exact=True)
        expect(sync).to_be_visible()
        assert page.evaluate("!JSON.parse(localStorage.getItem('navinocode_sync_diagnostics_v1')).scopes.browser.lastSuccess")
        sync.get_by_role('checkbox').check();sync.get_by_role('button',name='确认应用',exact=True).click()
        expect(sync).not_to_be_visible()
        assert durable(page)['workspaces'][0]['name']=='云端工作'
        passed('sync preview is read-only until confirmed and does not falsely mark preview as synced')
        page.evaluate('window.__failGet=true')
        native.get_by_role('button',name='立即上传',exact=True).click()
        expect(native.get_by_role('alert').first).to_contain_text('simulated offline')
        page.evaluate('window.__failGet=false')
        native.get_by_role('button',name='重试失败操作',exact=True).click()
        page.wait_for_function("JSON.parse(localStorage.getItem('navinocode_sync_diagnostics_v1')).scopes.browser.lastResult==='success'")
        native.get_by_role('button',name='启用自动同步',exact=True).click()
        native.get_by_role('button',name='暂停自动同步',exact=True).click()
        assert page.evaluate("localStorage.getItem('navinocode_native_sync_enabled')==='false'")
        passed('failed sync is visible, retry succeeds, pause takes effect without reload')
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2')
        page.screenshot(animations='disabled',path=str(OUT/'diagnostics-narrow.png'),full_page=True)
        passed('390px data panel has no horizontal document overflow')
        assert not errors, errors
        context.close()

        context=context_for(browser);page=context.new_page();errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(BASE);page.get_by_role('button',name='打开工作会话',exact=True).click()
        dialog=page.get_by_role('dialog',name='工作会话',exact=True)
        dialog.get_by_role('button',name='预览当前窗口',exact=True).click()
        dialog.get_by_label('会话名称',exact=True).fill('Morning session')
        expect(dialog.get_by_text('已去重 1 页',exact=False)).to_be_visible()
        dialog.get_by_role('button',name='保存选中标签页为会话',exact=True).click()
        assert page.evaluate("JSON.parse(localStorage.getItem('navinocode_local_sessions')).sessions[0].tabs.length===2")
        page.evaluate("window.__tabs=[{id:1,windowId:10,index:0,url:'https://already.example/',title:'Existing',pinned:true,groupId:-1}]")
        dialog.get_by_label('会话恢复目标',exact=True).select_option('current')
        dialog.get_by_role('button',name='生成恢复预览',exact=True).click()
        expect(dialog.get_by_role('region',name='会话恢复预览')).to_contain_text('最多新增 1 个')
        dialog.get_by_role('button',name='确认恢复 1 个标签页',exact=True).click()
        expect(dialog.get_by_text('已打开 1 页',exact=False).first).to_be_visible()
        ops=page.evaluate('window.__ops')
        assert any(op[0]=='create' for op in ops)
        assert all(1 not in op[1]['tabIds'] for op in ops if op[0]=='group')
        assert all(op[1]!=1 for op in ops if op[0]=='update')
        passed('named session saves only supported unique tabs and restores only missing URLs')
        dialog.get_by_role('button',name='生成恢复预览',exact=True).click()
        expect(dialog.get_by_role('button',name='确认恢复 0 个标签页',exact=True)).to_be_disabled()
        passed('repeated session restore preview deduplicates earlier successful opens')
        # A failed restore into a NEW window must not reopen its successful URLs.
        start = page.evaluate('window.__ops.length')
        page.evaluate("window.__failTabUrl='https://docs.example/'")
        dialog.get_by_label('会话恢复目标',exact=True).select_option('new')
        dialog.get_by_label('跳过当前窗口已经打开的网址',exact=True).uncheck()
        dialog.get_by_role('button',name='生成恢复预览',exact=True).click()
        dialog.get_by_role('button',name='确认恢复 2 个标签页',exact=True).click()
        expect(dialog.get_by_text('已打开 1 页',exact=False).first).to_contain_text('失败 1 页')
        expect(dialog.get_by_label('会话标签 Existing',exact=True)).not_to_be_checked()
        expect(dialog.get_by_label('会话标签 Docs',exact=True)).to_be_checked()
        page.evaluate("window.__failTabUrl=''")
        dialog.get_by_role('button',name='生成恢复预览',exact=True).click()
        dialog.get_by_role('button',name='确认恢复 1 个标签页',exact=True).click()
        expect(dialog.get_by_text('已打开 1 页',exact=False).first).to_contain_text('失败 0 页')
        windows = [op[1]['url'] for op in page.evaluate('window.__ops')[start:] if op[0]=='window']
        assert windows == ['https://already.example/', 'https://docs.example/'], windows
        passed('partial new-window restore selects only failed URLs for retry')

        page.screenshot(animations='disabled',path=str(OUT/'sessions-desktop.png'),full_page=True)
        page.set_viewport_size({'width':390,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2')
        page.screenshot(animations='disabled',path=str(OUT/'sessions-narrow.png'),full_page=True)
        assert not errors, errors
        passed('390px session layout and all exercised pages have no uncaught runtime errors')
        context.close();browser.close()
    (OUT/'smoke-p0p1.json').write_text(json.dumps({'passed':len(results),'checks':results,'limitations':'Real production DOM/localStorage; extension APIs are mocks, not account sync or native IME validation.'},ensure_ascii=False,indent=2))
    print(f'{len(results)} P0/P1 browser smoke checks passed.')
finally:
    server.terminate()
    try: server.wait(timeout=5)
    except subprocess.TimeoutExpired: server.kill()
    server_log.close()
