"""One-time, hash-guarded transfer of an already tested local source edit set.
Only prepares Git objects in this repository; never changes a branch reference.
"""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

EXPECTED = '229f80b0418bb719199aaa55d15e6c094394208b0db29529cd824fd14bd78698'
PARTS = [Path(f'.integration/workspace-part-{i:02}.txt') for i in range(6)]
ALLOWED = set('''.github/workflows/verify.yml
.gitignore
docs/workspace-library-2026-09-17.md
scripts/smoke-workspaces.py
src/advanced/AdvancedFeatures.jsx
src/advanced/CommandCenter.jsx
src/advanced/SyncControls.jsx
src/advanced/WorkspaceErrorBoundary.jsx
src/advanced/WorkspaceHomeFolders.jsx
src/advanced/WorkspaceManager.jsx
src/advanced/WorkspaceSwitcher.jsx
src/advanced/defaultApps.js
src/advanced/nativeSync.js
src/advanced/storage.js
src/advanced/syncMerge.js
src/advanced/useWorkspaceStore.js
src/advanced/workspaceModel.js
src/components/AppSelector.jsx
src/components/DraggableBottomBar.jsx
src/components/DraggableWidget.jsx
src/components/PomodoroTimer.jsx
src/components/TodoWidget.jsx
src/lib/cloudSync.js
src/lib/siteIcons.js
src/main.jsx
src/pages/Index.jsx
tests/state-sync.test.js
tests/workspace-library.test.js'''.splitlines())

def blob_hash(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

def recipe():
    texts = [p.read_text(encoding='ascii') for p in PARTS]
    # Correct four explicitly identified transport insertions; whole-payload
    # SHA-256 below, then every old/new Git blob SHA, remain mandatory guards.
    for bad, good in [('XO09rFdbiM', 'XO09rdbiM'), ('Vu6/ttv7J', 'Vu6/tv7J'),
                      ('O7165dS2', 'O7165S2'), ('ly7wAXT4', 'ly7AXT4')]:
        assert texts[0].count(bad) == 1, bad
        texts[0] = texts[0].replace(bad, good)
    data = gzip.decompress(base64.b64decode(''.join(texts), validate=True))
    assert hashlib.sha256(data).hexdigest() == EXPECTED, 'payload checksum mismatch'
    rows = json.loads(data)
    assert len(rows) == 28 and {r['path'] for r in rows} == ALLOWED
    return rows

def apply():
    output = []
    for row in recipe():
        p = Path(row['path'])
        assert not p.is_symlink() and not any(x.is_symlink() for x in p.parents)
        if row['old'] is None:
            assert not p.exists(), str(p)
            original = b''
        else:
            original = p.read_bytes()
            assert blob_hash(original) == row['old'], f'base changed: {p}'
        lines = original.decode('utf-8').splitlines(keepends=True)
        last_start = len(lines)
        for start, end, replacement in reversed(row['edits']):
            assert 0 <= start <= end <= last_start
            lines[start:end] = replacement.splitlines(keepends=True)
            last_start = start
        updated = ''.join(lines).encode('utf-8')
        assert row['new'] is None and not updated or blob_hash(updated) == row['new'], str(p)
        output.append((p, None if row['new'] is None else updated))
    # No file is touched until the entire edit set has been checked.
    for p, data in output:
        if data is None:
            p.unlink()
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(data)
    print('Applied 28 source edits; all base and target Git blob hashes verified.')

def prepare_tree():
    assert os.environ['GITHUB_REPOSITORY'] == 'AngKernel/Navinocode'
    assert os.environ['GITHUB_REF'] == 'refs/heads/refactor/unified-workspace-library'
    base = os.environ['GITHUB_SHA']
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == base
    rows = recipe()
    entries = []
    # Recheck source after all tests/build commands, before preparing Git objects.
    for row in rows:
        p = Path(row['path'])
        if row['new'] is None:
            assert not p.exists(), str(p)
        else:
            assert blob_hash(p.read_bytes()) == row['new'], f'target changed: {p}'
    def api(path, data=None):
        url = 'https://api.github.com/repos/AngKernel/Navinocode/' + path
        req = urllib.request.Request(url, data=None if data is None else json.dumps(data).encode(),
            headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                     'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json',
                     'User-Agent': 'Navinocode-verified-integration'})
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    for row in rows:
        sha = None
        if row['new'] is not None:
            result = api('git/blobs', {'encoding': 'base64',
                'content': base64.b64encode(Path(row['path']).read_bytes()).decode('ascii')})
            sha = result['sha']
            assert sha == row['new']
        entries.append({'path': row['path'], 'mode': '100644', 'type': 'blob', 'sha': sha})
    transient = [str(p) for p in PARTS] + ['.integration/ready', '.integration/apply.py',
        '.github/workflows/integrate-workspace-once.yml']
    entries.extend({'path': p, 'mode': '100644', 'type': 'blob', 'sha': None} for p in transient)
    base_tree = api('git/commits/' + base)['tree']['sha']
    tree = api('git/trees', {'base_tree': base_tree, 'tree': entries})
    result = {'base_commit': base, 'tree_sha': tree['sha'], 'payload_sha256': EXPECTED,
              'changed_source_files': len(rows), 'temporary_files_removed': transient,
              'note': 'Objects prepared only. No commit or branch reference has been changed.'}
    print('VERIFIED_WORKSPACE_TREE=' + json.dumps(result))
    Path('/tmp/workspace-integration-result.json').write_text(json.dumps(result, indent=2))

if __name__ == '__main__':
    {'apply': apply, 'prepare-tree': prepare_tree}[sys.argv[1]]()
