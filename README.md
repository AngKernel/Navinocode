# Navinocode

Navinocode 是一个可自定义的新标签页，支持命令搜索、多引擎搜索、快捷应用、工作空间、待办事项、番茄钟、使用热力图、主题背景和可选同步。项目既可以作为普通 Web 页面运行，也可以构建为 Microsoft Edge / Chromium Manifest V3 扩展。

项目采用 MIT License。

## 功能

- Google、Bing、百度和 DuckDuckGo 多引擎搜索
- `Ctrl/⌘ + K` 命令中心，统一搜索应用并执行搜索、待办、番茄钟、计算和主题命令
- 搜索历史和本地应用统一检索；可选择开启 Bing 在线搜索建议（默认关闭）
- 扩展模式下可按需授权并搜索当前标签页、书签、历史记录和常用网站
- 可拖动、排序和编辑的应用 Dock
- 多工作空间、应用文件夹和独立应用布局
- 待办、番茄钟和使用热力图小组件
- 浅色、深色、跟随系统主题及自定义背景
- 本地配置 JSON 导入和导出
- 可选的用户自有 Supabase 云同步，带 revision 和跨设备冲突合并
- 可选的 Edge/Chromium 浏览器账户原生同步
- Edge/Chromium 新标签页扩展构建与商店 ZIP 打包

### 命令中心示例

```text
g React hooks       使用 Google 搜索
b Edge 扩展开发      使用 Bing 搜索
bd 北京天气          使用百度搜索
ddg privacy         使用 DuckDuckGo 搜索
todo 写周报          新建待办
timer 45             设置 45 分钟番茄钟
calc 120*0.85        计算并复制结果
theme dark           切换深色主题
```

## 开发环境

项目使用 Node.js 18，版本记录在 `.nvmrc`。

```bash
nvm use
npm install
npm run dev
```

开发服务器默认运行在 <http://localhost:8080>。

常用命令：

```bash
npm run build              # Web 生产构建，输出到 build/
npm run build:dev          # development mode 构建
npm run preview            # 预览生产构建
npm run lint               # ESLint；当前仓库缺少配置，属于已知基线问题
npm run build:extension    # 生成可加载的 extension/ 目录
npm run validate:extension # 校验 Manifest、资源、CSP 和版本一致性
npm run generate-icons     # 用 public/icons/icon.png 生成各尺寸扩展图标，需要 ffmpeg
```

## 本地加载 Edge 扩展

```bash
npm run build:extension
npm run validate:extension
```

然后打开 `edge://extensions/`：

1. 开启“开发人员模式”。
2. 选择“加载解压缩的扩展”。
3. 选择项目下的 `extension/` 目录。
4. 新建标签页，检查搜索、命令中心、工作空间、应用 Dock、设置面板和小组件。
5. 浏览器书签、历史和标签页搜索只有在用户主动授权后才会启用。

`build/` 和 `extension/` 都是生成目录，不应直接编辑或提交。

## Edge 商店发布包

Microsoft Edge Add-ons 接收 ZIP，且 `manifest.json` 必须位于 ZIP 根目录。项目提供了两种打包方式。

### 打包当前版本

```bash
npm run package:edge
```

该命令会依次：

1. 检查 `package.json` 与 `public/manifest.json` 版本一致。
2. 重新构建并校验扩展。
3. 生成 `releases/navinocode-edge-v<version>.zip`。
4. 生成同版本的 `.sha256` 和 `.json` 构建元数据。

同版本发布包默认不能被覆盖。仅在本地重新验证时使用：

```bash
npm run package:edge -- --force
```

校验生成包：

```bash
cd releases
sha256sum -c navinocode-edge-v<version>.sha256
```

Linux/macOS 打包需要系统提供 `zip` 命令；Windows 使用 PowerShell `Compress-Archive`。

### 发布新版本

```bash
npm run release:edge -- patch
npm run release:edge -- minor
npm run release:edge -- major
npm run release:edge -- 1.2.0
```

发布命令会先将 `public/manifest.json` 和 `package.json` 同步到更高版本，再构建发布包。它不会自动执行 Git commit、tag、push 或上传 Partner Center。

Edge 清单允许 1～4 个点分隔整数，每段范围为 `0`～`65535`，非零数字不能以 `0` 开头。为了同时兼容 `package.json`，本项目发布脚本进一步固定使用 `主版本.次版本.修订版本` 三段格式，例如 `1.2.0`。Edge 更新包必须使用高于已上架版本的版本号。

建议约定：

- `patch`：缺陷修复、样式微调、权限说明更新。
- `minor`：向后兼容的新功能。
- `major`：存在明显行为变化或数据迁移的大版本。

## Edge Add-ons 提交检查清单

提交前至少完成以下检查：

- 工作区中的版本修改已经审查，ZIP 对应唯一版本。
- 在 Edge 中通过“加载解压缩的扩展”完成真实烟测。
- ZIP 根目录存在 `manifest.json`，不包含 `.env`、源码映射或开发文件。
- 新标签页替换行为在商店描述中明确说明。
- 所有远程服务都可用；服务失败时核心新标签页仍能打开。
- Partner Center 的权限说明与 `manifest.json` 完全一致。
- 将 [PRIVACY.md](./PRIVACY.md) 发布到无需登录即可访问的 HTTPS 地址，并在 Partner Center 填写该 URL。
- 准备每种语言的扩展 Logo 和描述；可选小宣传图为 `440 x 280` PNG，大宣传图为 `1400 x 560` PNG。
- 截图最多 6 张，尺寸使用 `640 x 480` 或 `1280 x 800`。

推荐的单一用途描述：

> Navinocode 用一个可自定义的效率导航页替换 Microsoft Edge 新标签页，集中提供命令搜索、常用网站入口、工作空间和本地效率小组件。

权限说明：

| 权限 | 用途 |
| --- | --- |
| `unlimitedStorage` | 在本地保存用户上传的背景图片、应用配置、待办和组件布局，避免较大的图片数据触发普通存储配额。 |
| `storage` | 仅在用户主动启用浏览器原生同步后，通过 `chrome.storage.sync` 保存轻量配置。 |
| `bookmarks` | 可选权限，仅在用户主动授权后在命令中心本地搜索书签。 |
| `history` | 可选权限，仅在用户主动授权后在命令中心本地搜索浏览历史。 |
| `tabs` | 可选权限，仅在用户主动授权后搜索并切换当前打开的标签页。 |
| `topSites` | 可选权限，仅在用户主动授权后搜索浏览器常用网站。 |
| `https://api.github.com/*` | 读取 Navinocode 公开仓库的 Star 数量。 |
| `https://api.bing.com/*` | 仅在用户主动开启“在线搜索建议”后，将输入内容发送至 Bing 获取搜索建议。该功能默认关闭。 |
| `https://v1.hitokoto.cn/*` | 获取搜索框占位短句；失败时使用内置文本。 |
| `https://*.supabase.co/*` 等 | 仅在用户主动填写自己的 Supabase 配置后，同步应用、待办、工作空间和外观设置。 |

扩展不下载或执行远程代码。书签、历史记录、标签页和常用网站只在本机检索，不会写入 Supabase 或浏览器原生同步。

Microsoft 官方资料：

- [发布 Microsoft Edge 扩展](https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension)
- [Edge 扩展清单格式](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/manifest-format)
- [Edge Add-ons 开发者政策](https://learn.microsoft.com/en-us/legal/microsoft-edge/extensions/developer-policies)

## Supabase 云同步

云同步完全可选。URL、anon key 和同步 ID 由用户在设置面板中填写，保存在当前浏览器扩展的本地存储中；导出的配置文件不包含 Supabase URL 或 anon key。

基础表结构：

```sql
create table if not exists navinocode_states (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table navinocode_states enable row level security;
```

当前前端没有 Supabase 登录流程，因此不能仅依赖同步 ID 实现严格的用户身份隔离。不要在同步数据中保存密码、Token、财务信息等敏感数据。公开发布前，应根据自己的 Supabase Auth 方案创建最小权限 RLS；不建议把 `using (true)` 的匿名全表策略用于生产环境。

多台设备填写相同同步 ID 时会使用同一行数据。同步数据包含 revision、deviceId 和更新时间；上传前会读取云端版本。发现其他设备在当前基础版本之后修改过数据时，会合并两端的应用、待办、工作空间和文件夹，再写入新 revision。该策略可以降低整体状态被旧设备直接覆盖的风险，但重要配置仍建议保留本地导出文件。

## 浏览器原生同步

扩展模式下可以选择使用 Edge/Chromium 浏览器账户同步：

- 使用 `chrome.storage.sync`，不需要用户配置第三方数据库。
- 同步应用、待办、工作空间、文件夹、组件设置和轻量外观设置。
- 本地背景图片和 data URL 自定义图标不会上传。
- 数据会分片写入，并在接近浏览器同步配额时停止上传并提示用户。
- 自动同步仅在扩展新标签页运行期间检查变化，也可以在工作空间面板中手动上传或下载。
- 与 Supabase 同步使用相同的 revision 和合并思路，发现并发修改时保留两端实体。

## 目录概览

```text
src/advanced/         命令中心、工作空间、浏览器数据和同步模块
src/                  React 应用代码
public/manifest.json  Edge/Chromium 扩展清单和版本源
scripts/              构建、校验和商店打包脚本
build/                Web 构建产物
extension/            解压加载目录
releases/             Edge 商店 ZIP、校验和与构建元数据
```

## 隐私

数据处理说明见 [PRIVACY.md](./PRIVACY.md)。提交 Edge Add-ons 前，需要将该文件托管到公开、稳定的 HTTPS URL；仓库公开后可使用：

```text
https://github.com/AngKernel/Navinocode/blob/main/PRIVACY.md
```

## 项目来源与许可证

本项目基于 [XuYouo/Navinocode](https://github.com/XuYouo/Navinocode) 开发，并在其基础上持续进行功能优化、兼容性改进和 Microsoft Edge 扩展维护。维护者此前曾向原项目提交改进 PR；由于上游的 Edge 扩展版本长期未更新，本仓库继续完善扩展功能、隐私控制、版本管理和 Edge 商店发布流程。

本项目是独立维护版本，并非上游项目的官方发布版本。感谢原作者及所有贡献者提供的设计与代码基础。

项目依据 [MIT License](./LICENSE) 发布。使用、修改或分发本项目时，请同时保留许可证中要求的版权声明和许可声明。
