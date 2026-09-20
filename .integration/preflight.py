from pathlib import Path
p = Path('scripts/smoke-p0p1.py')
s = p.read_text()
old = "        expect(restore.get_by_text('First edit',exact=False).first).to_be_visible()"
new = "        restore.locator('[data-testid=\"snapshot-diff\"] summary').first.click()\n" + old
assert s.count(old) == 1
s = s.replace(old, new)
old = "        page.screenshot(path=str(OUT/'recovery-diff.png'),full_page=True)"
new = "        restore.locator('[data-testid=\"snapshot-diff\"] summary').first.click()\n" + old
assert s.count(old) == 1
s = s.replace(old, new)
p.write_text(s)
print('Recovery browser check expands the same details control used by readers')
