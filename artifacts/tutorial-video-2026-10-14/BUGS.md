# 自然语言图片编辑 — 录制过程发现的 Bug 清单（给 codex 统一修改）

- 日期：2026-10-14
- 环境：Windows 11 · Node 22.22.2 · pnpm monorepo · apps/web (Next 16.4.0 dev, :3000) · apps/api (NestJS) · PhotoCraft CLI 0.6.0 · 本机 Ollama qwen3:4b/8b · 本机 rembg 蒙版服务 (:4102)
- 录制产物：本目录 `tutorial.mp4`（教学视频）、`a01–a06 / b01–b07` 截图、`run5-backup/`（第 5 次运行的截图备份）
- 复现基线：直接访问 `http://127.0.0.1:3000`（以下 BUG 均与录制代理无关，代理只影响 BUG 1 的暴露程度）

## 一、仓库代码问题（建议 codex 修复）

### BUG A【严重】/image-studio：应用「蒙版重着色」后主画布空白
- 现象：上传帽子图 → 自然语言「把照片调亮一点，并加上文字『秋日新品』」→ 应用，画布正常显示帽子+文字（`a03-canvas-crop.png` 有图）。撤销 → 「自动抠图（本机）」生成蒙版 → 蒙版审核确认 → 重着色指令应用成功（状态栏提示已应用）→ **主画布只剩虚线点阵空画布**；右侧「属性」面板仍列出 `hat.png` 图层（含 X/Y 坐标），说明图层数据还在、只是画布不再渲染。
- 连续 3 次运行（run 4/5/6）全部复现；页面无 `<img>` 元素，canvas 像素全不透明（画布自绘背景），无控制台报错。
- 影响：用户会认为编辑失败或结果丢失。
- 证据：`a03-canvas-crop.png`（正常对照）vs `a06-recolored.png` / `a06-canvas-crop.png`（空白）；`run5-backup/` 内同样一组。
- 疑点方向：普通图层应用与蒙版重着色应用走了不同的画布重绘路径；或新版本图层的坐标/缩放把内容移出了可视区。

### BUG B【中】API 指令路由严格 Origin 校验：任何跨端口访问一律 403「跨站请求已拒绝」
- 位置：`apps/web/src/app/api/photocraft-instruction/route.ts:16-17`、`apps/web/src/app/api/image-instruction/route.ts:31-33`
- `origin !== new URL(request.url).origin` 即 403，且该校验在请求体校验**之前**。经任何非 3000 端口访问（VS Code 端口转发、反向代理、Docker 端口映射）都会触发：
  - /image-studio 页：静默回退「本地规则」，能力降级不易察觉（仅状态栏标注来源）；
  - /image-studio/photocraft 页：直接弹「Error: 跨站请求已拒绝」。
- 建议：development 下允许同 host 不同端口，或提供环境变量白名单。
- 证据：web dev log 多条 `POST /api/image-instruction 403` / `POST /api/photocraft-instruction 403`；curl 复现：带 `Origin: http://127.0.0.1:3100` → 403，不带 Origin → 200。

### BUG C【中】本地服务硬编码 CORS 允许清单
- 位置：`scripts/image_quality/local_mask_provider.py:21`、`scripts/photocraft/dev-bridge.mjs:26-31`
- 只允许 `localhost:3000/3001` 的 Origin，其他来源端口直接 403 且无提示。建议改为环境变量可配置。

### BUG D【轻】`/vendor/photocraft/fonts/manifest.txt` 每次加载 404
- 每次进入 PhotoCraft 页都会探测该路径（dev log 中多次 404）。前端字体探测逻辑或静态资源缺失，产生持续噪音。

### BUG E【轻】`next.config.ts` 缺 `allowedDevOrigins`
- dev log 警告：`Blocked cross-origin request to Next.js dev resource /__nextjs_font/geist-latin.woff2 from "127.0.0.1"`。加一行 `allowedDevOrigins: ['127.0.0.1']` 即可。

## 二、环境问题（非本仓库代码，提醒）

1. **Next 16.4.0 dev（Node 22.22.2）HMR websocket 握手失败**：真实浏览器带 `Sec-WebSocket-Extensions: permessage-deflate` 时 101 挂起；带 `Origin` 头直接 Unauthorized；两者都不带才握手成功。HMR 连不上 → 页面完整渲染但**永不 hydrate**（所有按钮/上传无响应，且无任何控制台报错，极难排查）。curl 三态可稳定复现。本次录制临时绕过：经 :3100 TCP 代理剥离相关头。建议尝试升级 Next patch 版本或更换 Node 小版本验证。
2. **rembg/onnxruntime 蒙版服务内存**：空闲约 471MB，每次推理后涨至约 7.3GB（arena 不释放），需重启进程回收。长时间使用建议加 arena 收缩参数或定期重启。

## 三、已知问题（文档已记录，非新发现）

- 帽沿重着色边缘残色：`AI_Creative_Suite_Dev_Pack_v3/CURRENT_STATE.md` 已记录的青色残边；改成红色时表现为红色光晕溢出到背景（`b07-applied.png` 可见）。

## 四、已排查、确认不是 bug

- PhotoCraft 左栏「只改帽沿」引导文案在按钮下方需滚动才能看到——正常滚动布局，非渲染问题。
- 重复启动 `next dev` 报「Another next dev server is already running」——dev 锁按设计工作。
- 早期录制中「解析编辑要求失败」——为录制工具输入故障 + BUG B 叠加所致；工具修复后 run 6/7 复测通过（本地规则解析正常返回 recolor/red/brim/protectLabel=true，甚至无需走 API）。
