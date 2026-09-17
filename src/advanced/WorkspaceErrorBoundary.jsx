import React from 'react';
import { ADVANCED_KEYS } from './storage';

// Fail closed for unsupported schemas, corrupt authoritative data or storage
// denial. Never silently clear user data to make a white-screen error disappear.
export default class WorkspaceErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  exportRaw = () => {
    try {
      const content = JSON.stringify(Object.fromEntries(Object.values(ADVANCED_KEYS).map((key) => [key, localStorage.getItem(key)])), null, 2);
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'navinocode-recovery-raw.json'; link.click(); URL.revokeObjectURL(url);
    } catch { this.setState({ error: new Error('浏览器禁止访问存储，请检查扩展/浏览器存储权限；未尝试删除数据') }); }
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-xl font-semibold">配置暂时无法读取</h1>
      <p>{this.state.error.message}</p><p>没有自动重置你的工作区。请先导出原始数据，再检查版本或存储权限。</p>
      <button type="button" onClick={this.exportRaw} className="rounded-xl border px-4 py-2">导出原始配置</button>
    </main>;
  }
}
