# Video Studio 首版试用包（2026-10-26）

## 系统要求

- Windows 11 / macOS / Linux（本试用包以 Windows 验证）
- Node.js 22+（推荐 LTS）
- pnpm 11.19.0（`packageManager` 字段锁定）
- Chrome / Edge（WebGL 支持）

## 启动步骤

```powershell
# 1. 克隆仓库
git clone <repo-url> animate && cd animate

# 2. 安装依赖（需 pnpm 11.19.0）
pnpm install --frozen-lockfile

# 3. 构建工作区包（首次必须）
pnpm -r build

# 4. 启动开发服务器
pnpm --filter @acs/web dev
# 或指定端口：
pnpm --filter @acs/web exec next dev --hostname 0.0.0.0 --port 3000

# 5. 打开浏览器
# http://localhost:3000/video-studio
```

## 环境检查

| 检查项 | 命令 | 预期 |
|---|---|---|
| Node 版本 | `node --version` | v22.x 或更高 |
| pnpm 版本 | `pnpm --version` | 11.19.0 |
| 依赖完整 | `pnpm install --frozen-lockfile` | exit 0 |
| 工作区构建 | `pnpm -r build` | exit 0（web build 可能因安全提醒 exit 1，不影响 dev server） |
| 页面可达 | `curl -o /dev/null -w "%{http_code}" http://localhost:3000/video-studio` | 200 |

## 可选配置

| 环境变量 | 用途 | 无此变量时 |
|---|---|---|
| `DASHSCOPE_API_KEY` | 生成有声版 MP4（TTS 旁白） | 有声按钮仍可点击，服务端返回"未配置 DASHSCOPE_API_KEY"错误（503）；无声版不受影响 |
| `ACS_MEDIA_STORE` | 媒体素材仓路径 | 使用默认用户目录 |

## 操作手册

### 创建项目

从「从样片开始」区选一个样片卡，点「使用此样片」。或点「新建项目」从空白开始，在「按用途选镜头」目录选配方卡添加镜头。

### 编辑

点镜头卡展开编辑表单。各组件有不同字段（标题、数值、标注、动画等）。改完点「应用修订」生成新版本。

### 动画调整

前后对比和里程碑镜头底部有「入场时序」（依次/同步）和「入场时长」（200–5000ms）。

### 预览

预览区点「横版」/「竖版」切换画幅。2D 镜头预览为动态播放；3D 镜头显示同源代表帧。

### 保存 / 重开 / 回滚

- 「保存」→ 持久化到浏览器本地存储
- 刷新 → 项目列表点「打开」恢复
- 编辑区版本下拉选旧版本 → 「回滚」

### 导出

- 「生成无声横竖版 MP4」→ 两条下载链接
- 「导出交互页（3D 镜头）」→ 自包含 HTML
- 「导出项目 JSON」→ 备份

### 转场

镜头列表下方「转场」区：选镜头边界 → 下拉选「淡入淡出」→ 调时长。

## 已知限制

1. 3D 镜头预览为静态代表帧（非动态播放）
2. 交互页为衍生演示（PerspectiveCamera），非出片机位复刻
3. 外部 3D 模型（.blend/GLB）不支持导入
4. 有声版需 `DASHSCOPE_API_KEY`（计费，按现有台账限额）
5. 首版不含自然语言分镜生成

## 问题反馈

在仓库 issue 中报告，附：
- 操作步骤（从打开页面到出错）
- 浏览器控制台截图（F12 → Console）
- 项目导出 JSON（工作台「导出项目 JSON」）

## 验收记录

干净浏览器资料目录（无开发者 IndexedDB），从 `main@655cbdf`：

| 步骤 | 结果 | 证据 |
|---|---|---|
| 季度样片创建（干净 context） | ✅ 6 镜/21.5s | `e2e-first-release-browser.mjs` 步骤 PASS |
| 逐镜 SceneSpec 校验 | ✅ 全过 | `first-release-acceptance.mjs`（`cd apps/web && node --import tsx ../../scripts/video/first-release-acceptance.mjs`） |
| 双画幅 H.264 MP4 | ✅ 516 帧/24fps | `render/*.mp4`，sha256 在 `acceptance-report.json` |
| 对比镜关键帧 | ✅ frameMap 推导 mid@9s/late@10.58s | `{aspect}-shot3-{mid,late}.png` |
| 时间轴关键帧 | ✅ frameMap 推导 mid@13s/late@14.58s | `{aspect}-shot4-{mid,late}.png` |
| 文字/对比编辑→保存→重开→回滚 | ✅ 浏览器链逐步 PASS | `browser-acceptance.json` |
| 横竖预览 + MP4 导出 | ✅ viewBox/下载链接断言 | 同上 + `browser-mp4-exported.png` |
| 样片卡 | VID-064 覆盖季度+旧版图示编辑；其余四卡未逐卡浏览器验证 | 待补或删宣称 |
