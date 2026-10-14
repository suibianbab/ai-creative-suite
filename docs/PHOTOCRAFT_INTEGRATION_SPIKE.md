# PhotoCraft 0.6.0 集成验证（2026-10-10）

## 已验证的闭环

- 官方 [PhotoCraft v0.6.0](https://github.com/storytold/photocraft/releases/tag/v0.6.0) Windows CLI 与 Web WASM 已按发布校验值固定版本；`scripts/photocraft/install.ps1` 安装到 Git 忽略目录。宿主适配脚本 `scripts/photocraft/web-host-adapter.js` 注入官方 Web HTML，官方 JS/WASM 文件保持原样。
- Web 宿主通过同源消息把 PNG/JPEG/WebP 或 `.pcraft` 送进官方画布，并截获官方保存的原生文件。浏览器 IndexedDB 保存 `.pcraft` 及版本，刷新后可直接重开。原始 PNG 在官方 Web 保存为 PSD 时，本机 PhotoCraft CLI 将它归一化为 `.pcraft`。
- NestJS API 新增独立的 PhotoCraft 项目/不可变版本记录（迁移 `0005_photocraft_projects.sql`）。原生源和可选原图使用现有 Asset Foundation；工作区授权、租户范围、预期版本、幂等请求均由服务端校验。Keycloak 登录经已注册的 `/image-studio` 回调再返回 PhotoCraft 页面。
- 真实浏览器测试：将两层黑帽 `.pcraft` 导入官方画布，保存本地第 1 版，上传云端第 1 版，刷新后从云端重开；画布可见原始像素层和带蒙版的 Hue/Saturation 层；再次保存后云端版本升至 2。真实 PostgreSQL/RustFS 集成测试还覆盖匿名、跨工作区、过期版本、幂等重放和原图身份不变。
- 自制的 `qa/fixtures/photocraft-hat-teal.png` 有 `FORM 01` 缝制标签。输入“将帽子的颜色换成黑色”，在面料亮部、暗部和帽沿选 4 点后，PhotoCraft CLI 的 `select.colorRange` 与蒙版 Hue/Saturation 调整层生成黑帽预览；确认后保存可编辑 `.pcraft`，刷新可重开。样片目测标签可读、缝线和纹理仍在、背景基本不变。对比同一裁切区域的平均 RGB 变化：帽身约 62.8、帽沿约 67.4、标签约 6.3、背景约 0.2；标签有轻微变暗，不能称为像素级保护。

## 使用

1. Windows PowerShell 执行 `scripts/photocraft/install.ps1`，再执行 `pnpm dev:photocraft-bridge`。
2. 启动 API 与 Web，访问 `http://localhost:3000/image-studio/photocraft`。本机桥接服务只监听 `127.0.0.1:4112`。
3. 选图并在画布中打开；用“保存画布项目”保存，刷新后从“本浏览器项目”重开。登录开发工作区后可保存云端并重开。
4. 局部编辑先点击“解析编辑要求”，按计划点击取样点或画轮廓/作用框/保护框，再看预览、应用并保存。回归步骤见 `qa/registry.json` 的 UI-011～UI-013；新增能力和边界见 `docs/PHOTOCRAFT_NL_EDITING.md`。

## 当前边界

- 局部编辑已扩到受限换色和亮度/对比度/饱和度，支持轮廓、取样、作用框与标签保护框。本机 Qwen3 4B 经 `llama-server` 已能解析部分非规则句式。仍没有任意自然语言修图；手工轮廓样片有可见边缘残留，不能把样片质量外推到其他商品或复杂透明材质，详见 `docs/PHOTOCRAFT_NL_EDITING.md`。
- Web 适配利用 PhotoCraft 0.6.0 的 DOM 和下载行为，是明确的版本锁定方案。升级上游时必须重新跑打开、编辑、保存、重开和像素 QA。没有上游稳定宿主控制 API 的保证。
- `dev-bridge.mjs` 为本机开发服务，固定命令白名单并校验来源，不是多租户生产任务服务。正式部署仍需把 CLI 执行迁入受控沙箱/任务队列、接入限额与审计，并对上传的 `.pcraft` 做完整格式验证。浏览器 IndexedDB 只按浏览器资料隔离，共享资料中的本地项目可见；云端项目由工作区授权隔离。
- 旧 ImageDocument 项目保留在原入口；没有批量迁移或删除。PhotoCraft 原生源为新项目的编辑主源，平台只维护项目、资产和版本引用。

上游依据：[Web 自托管说明](https://github.com/storytold/photocraft/blob/main/packaging/web/README.md)、[CLI 与控制接口](https://github.com/storytold/photocraft/blob/main/docs/control-protocol.md)。
