# Codex：Video Studio 浏览器项目包入口

基线 `main@518203e`，分支 `codex/video-portable-workbench`。本线负责浏览器导出/导入一个可移植项目包，复用 `scripts/video/portable-package.mjs` 的 pack/verify/restore；不改 `VideoProject` schema，不碰 Claude 的数据动画样片与组件文件。主检出已有未提交资料，开发只在 Codex 工作树。

## 契约

- 目录包 v1 保持原状。浏览器传输增加单文件 `acs-video-portable-envelope@1`：`files[]` 内是目录包的相对路径与 base64 字节；文件集合和每个 SHA-256 均由目录包 `manifest.json` 与既有 verify 检查。
- 仅本地开发环境、同源请求。单文件上限 32 MiB 编码体积；更大的媒体项目继续使用 CLI 目录包。限制须在 UI 明示。不能把本地原始路径写进下载文件。
- 导出用当前工作项目与引用的 Style Bible，先调用现有 pack，再封装下载；缺媒体、摘要不符或风格规范不符时不提供成功下载。
- 导入先对封装路径/数量/大小做上限检查，重建临时目录包后调用 verify/restore。浏览器项目与 Style Bible 应在同一 IndexedDB 事务内落库；失败不留下成功项目。恢复到媒体仓的原件如果后续浏览器事务失败，允许留下不可见的内容寻址缓存，但必须在报告中明示。

## 验收

浏览器项目 → 导出单文件 → 新浏览器上下文导入 → 保存重开 → 真实双画幅出片。媒体与 Style Bible 分别核对；篡改摘要、缺文件、路径穿越、重复路径、过大请求与已有项目冲突均拒绝。原项目 JSON 导入/导出与 CLI 目录包继续可用。Codex 提交后交 Claude 复核包边界、失败原子性和恢复链路。

## 实施与验收结果

- `scripts/video/portable-envelope.mjs` 把已校验目录包封装成单文件，导入时先检查路径/重复项/大小，再调用原 `verifyPortableBundle` 和 `restorePortableBundle`。Next 路由通过 `portable-envelope-cli.mjs` 子进程调用核心：Turbopack 对工作区绝对文件 URL 的动态 import 在真实浏览器下报 `Cannot find module as expression is too dynamic`，改为子进程后实测通过。
- 工作台新增“导出/导入可移植项目包（含素材）”。导出先保存项目，检查 Style Bible 并提供浏览器下载；导入在 `importPortableVideoProject` 的单个 IndexedDB 事务内提交项目、版本快照与 Style Bible。若服务端媒体已恢复、浏览器事务随后冲突，可能留下不可见的内容寻址原件缓存，但不会留下半个项目/风格记录。
- `VID-049`：商品样片在专用测试媒体仓导出包，删除原件后在全新浏览器上下文先导入篡改媒体字节的坏包，页面提示 SHA-256 错误、项目列表仍空、媒体原件未恢复；再导入正确包，原件 SHA-256 `1880911db62601d353642ed559d08c6da85bbb6e582263b1b42e67209ad47f2f` 恢复一致。刷新重开、横竖两版 H.264 出片。横版 1280×720，214,958 字节，SHA-256 `cd5dd855445b1fb33db4adca2a0ab325dd4876d2521dc6429fe2ff5f1df5a60a`；竖版 720×1280，344,677 字节，SHA-256 `f7d70a94f08ab88722e85f1a57ed86079d58586bffed8b500d25d0bdc07e6857`。证据 `.tools/video-portable-workbench-e2e/report.json`。家装样片带 Style Bible 的单文件包在另一个全新浏览器上下文导入、重开并双画幅出片，`.tools/video-portable-style-e2e/report.json` 的 `aspectDownloads=2`、`consoleErrors=[]`。
- 自动验证：web 287/287；portable-package、portable-envelope 和 TTS 36/36（含旧无媒体/无 Style Bible 项目往返）；全工作区 typecheck；Biome 445 文件；QA 注册表 101 自动/56 手动。无 TTS 请求。TTS 遗留锁错误现显示 PID、修改时间与核实后删除的恢复步骤，不自动清除计费锁。

## 交叉审核焦点与保留边界

1. 请审 `portable-envelope.mjs` 的 base64/路径集合/32 MiB 容量闸，及 Next 路由的本地开发/同源限制。单文件格式是目录包的传输封装，不是新的项目 schema；浏览器路径会把包内容暂存在内存，超过上限须用 CLI 目录包。
2. 请审 `importPortableVideoProject` 在项目冲突或 Style Bible 冲突时的事务原子性，以及服务端媒体恢复和客户端 IndexedDB 提交之间的边界。`renderRecords` 与历史交付中的旧本机路径仍是审计数据，包中没有历史视频、TTS WAV 或 proxy。
3. 请核对产品样片媒体与家装 Style Bible 两条真实浏览器链路的证据；它们只验证无声出片和结构化素材迁移，不能推断云端上传安全或商业画质。
