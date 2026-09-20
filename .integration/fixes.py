from pathlib import Path
p = Path('scripts/smoke-p0p1.py')
s = p.read_text()
s = s.replace("callback(cb, __tabs);", "callback(cb, value.currentWindow ? __tabs.filter(tab => tab.windowId === 10) : __tabs);")
s = s.replace("select_option('new')", "select_option('current')")
s = s.replace("assert any(op[0]=='window' for op in ops)", "assert any(op[0]=='create' for op in ops)")
s = s.replace("page.screenshot(path=str(OUT/", "page.screenshot(animations='disabled',path=str(OUT/")
s = s.replace("        page.screenshot(animations='disabled',path=str(OUT/'organizer-desktop.png'),full_page=True)\n        page.keyboard.press('Escape')", "        expect(importer).not_to_be_visible()\n        page.screenshot(animations='disabled',path=str(OUT/'organizer-desktop.png'),full_page=True)\n        library.get_by_role('button',name='Close',exact=True).click()\n        expect(library).not_to_be_visible()")
s = s.replace("window.__failGet = false;", "window.__failGet = false; window.__failTabUrl = '';")
s = s.replace("__ops.push(['create', value]); const tab", "__ops.push(['create', value]); if (value.url === __failTabUrl) { queueMicrotask(()=>{runtime.lastError={message:'simulated tab failure'};cb();delete runtime.lastError;});return; } const tab")
anchor = "        passed('repeated session restore preview deduplicates earlier successful opens')"
extra = '''
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
'''
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + extra)
p.write_text(s)
p = Path('src/advanced/SessionManager.jsx')
s = p.read_text()
old = "}, (value) => { setResult(value); setPreview(null); toast(`已打开 ${value.opened.length} 个标签页，未关闭任何现有页面`); });"
new = """}, (value) => {
    setResult(value); setPreview(null);
    // A new-window retry cannot rely on the current-window URL query. Keep
    // only failed URLs selected so successful opens are never repeated.
    if (value.failed.length) setSelection(new Set(value.failed.map((item) => item.url)));
    toast(`已打开 ${value.opened.length} 个标签页，未关闭任何现有页面`);
  });"""
assert s.count(old) == 1
s = s.replace(old, new).replace('重新生成预览可重试；默认会跳过已经成功打开的页面。', '已只选中失败页面；重新生成预览可重试，不会重复打开本次成功的页面。')
p.write_text(s)
p = Path('tests/state-sync.test.js')
s = p.read_text()
anchor = "import * as native from '../src/advanced/nativeSync.js';"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + "\nimport { getSyncDiagnostics } from '../src/advanced/syncDiagnostics.js';")
old = "  await assert.rejects(native.pullNativeSnapshot(), /尚未完整/);\n  assert.deepEqual([...localStorage.values], before);"
new = """  const previousSuccess = getSyncDiagnostics('browser').lastSuccess;
  await assert.rejects(native.pullNativeSnapshot(), /尚未完整/);
  // Failure diagnostics are expected; every pre-existing business/storage key
  // must still be byte-for-byte unchanged, with no partial recovery or revision.
  assert.deepEqual([...localStorage.values].filter(([key]) => key !== 'navinocode_sync_diagnostics_v1'), before);
  const diagnostic = JSON.parse(localStorage.getItem('navinocode_sync_diagnostics_v1')).scopes.browser;
  assert.equal(diagnostic.lastResult, 'error');
  assert.match(diagnostic.lastError, /尚未完整/);
  assert.equal(diagnostic.lastSuccess, previousSuccess);"""
assert s.count(old) == 1
p.write_text(s.replace(old, new))
print('Applied dialog lifecycle smoke checks, new-window retry protection and sync diagnostic invariants')
