from pathlib import Path
p = Path('scripts/smoke-p0p1.py')
s = p.read_text()
s = s.replace("callback(cb, __tabs);", "callback(cb, value.currentWindow ? __tabs.filter(tab => tab.windowId === 10) : __tabs);")
s = s.replace("select_option('new')", "select_option('current')")
s = s.replace("assert any(op[0]=='window' for op in ops)", "assert any(op[0]=='create' for op in ops)")
p.write_text(s)
print('Applied current-window session smoke semantics; new-window transport covered by unit tests')
