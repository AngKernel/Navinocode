from pathlib import Path
p = Path('scripts/smoke-p0p1.py')
s = p.read_text()
s = s.replace("callback(cb, __tabs);", "callback(cb, value.currentWindow ? __tabs.filter(tab => tab.windowId === 10) : __tabs);")
s = s.replace("select_option('new')", "select_option('current')")
s = s.replace("assert any(op[0]=='window' for op in ops)", "assert any(op[0]=='create' for op in ops)")
p.write_text(s)
print('Applied current-window session smoke semantics; new-window transport covered by unit tests')
p = Path('tests/state-sync.test.js')
s = p.read_text()
old = "  await assert.rejects(native.pullNativeSnapshot(), /尚未完整/);\n  assert.deepEqual([...localStorage.values], before);"
new = """  await assert.rejects(native.pullNativeSnapshot(), /尚未完整/);
  // Failure diagnostics are expected; every pre-existing business/storage key
  // must still be byte-for-byte unchanged, with no partial recovery or revision.
  assert.deepEqual([...localStorage.values].filter(([key]) => key !== 'navinocode_sync_diagnostics_v1'), before);
  const diagnostic = JSON.parse(localStorage.getItem('navinocode_sync_diagnostics_v1')).scopes.browser;
  assert.equal(diagnostic.lastResult, 'error');
  assert.match(diagnostic.lastError, /尚未完整/);
  assert.equal(diagnostic.lastSuccess, undefined);"""
assert s.count(old) == 1
p.write_text(s.replace(old, new))
