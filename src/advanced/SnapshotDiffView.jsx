import React, { useMemo } from 'react';
import { diffSnapshots } from './snapshotDiff.js';

const labels = { added: '新增', removed: '删除', changed: '修改' };
const SnapshotDiffView = ({ before, after }) => {
  const diff = useMemo(() => diffSnapshots(before, after), [before, after]);
  return <div className="min-w-0 space-y-3" data-testid="snapshot-diff">
    <p className="text-sm font-medium" role="status">新增 {diff.added} 项 · 删除 {diff.removed} 项 · 修改 {diff.changed} 项</p>
    <div className="max-h-[38vh] overflow-y-auto rounded-xl border p-3 text-sm">
      {!diff.total && <p className="text-muted-foreground">没有可见业务数据差异（版本号和删除标记不列入此表）。</p>}
      {diff.items.map((item) => <details key={item.key} className="border-b py-2 last:border-0">
        <summary className="cursor-pointer break-all">{labels[item.action]} · {item.kind} · {item.path}</summary>
        <dl className="mt-2 space-y-2 pl-3 text-xs text-muted-foreground">
          {item.changes.map((change) => <div key={change.field} className="min-w-0 break-all">
            <dt className="font-medium">{change.field}</dt>
            <dd>之前：{change.before}</dd><dd>之后：{change.after}</dd>
          </div>)}
        </dl>
      </details>)}
      {diff.truncated && <p className="mt-2 text-muted-foreground">共 {diff.total} 项变化，仅展开前 {diff.items.length} 项；导出配置可检查完整内容。</p>}
    </div>
  </div>;
};
export default SnapshotDiffView;
