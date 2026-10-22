# Video Studio E0：GIF / SVG 交付记录补齐

日期：2026-10-22。范围仅为现有 GIF、单镜 SVG 导出及 `DeliveryRecord`；不改变出片画面、帧数或项目主数据结构。

## 实现

- `DeliveryRecord.kind` 扩展为 `interactive-html | gif | shot-svg`。有 `kind` 的新记录必须同时有 `outputRef`（实际产物文件名）和 `digest`（实际产物字节的 SHA-256）；旧五键记录仍合法，读取时不迁移、不补假摘要。
- GIF 先由 ffmpeg 写入暂存文件并经 ffprobe 检查，再流式计算 SHA-256；SVG 先写入暂存文件再计算 SHA-256。两者都先通过 `appendDelivery` 的项目校验，再提交产物与项目文件。
- 两个 CLI 共用 `commitDeliveryFiles`：以临时文件回写项目；项目回写失败时恢复原产物，原本没有产物则删除新产物。临时产物清理不影响旧交付记录。`outputRef` 是文件名，仍以导出命令的 `--out` 目录为产物所在目录。
- `VID-015` 端到端脚本改在 gitignored `.tools/video-studio-export-e2e/` 输出，避免重跑改写入库的历史证据。

## 验证

- `@acs/video-document` 148/148：含旧交付记录兼容、新 `kind` 必填字段和非法字段拒绝。
- `scripts/video/delivery.test.mjs`：提交成功；项目回写失败时旧产物恢复；无旧产物时新产物删除。三个场景均检查项目旧字节不变与临时文件清理。
- `node scripts/video/e2e-export.mjs` 真实执行整片双画幅渲染、GIF 转码与 ffprobe、动画 SVG、静态 SVG、重复导出；退出码 0。每条新交付记录的 `digest` 均与实际文件哈希逐字节一致。额外强制 ffmpeg 失败和 SVG 帧号错误，确认项目与既有产物字节不变；TTS 台账无新增。
- 仓库历史文件 `artifacts/video-studio-export/e2e.video-project.json` 含四条无 `kind/outputRef/digest` 的旧交付记录，已用当前 `validateVideoProject` 实际回读通过。

本机实测哈希：`landscape.gif` 为 `314b867783207ae0a8f0d4a5b35a0440e2caafadaf9c5138937527e3074740aa`；`shot-2-animated-12fps.svg` 为 `12337f7b0362ac919f1eca1b0ace1ff5d6a5b920a08040c1dc9ff3f46ce421cc`；`shot-3-frame-24.svg` 为 `1a9491ffd7f5d0cbc04fcbcfc1666982958c371d42e4338ccef9e169d4a0b4b9`。这些哈希针对本机当前编码器和源项目，验收以脚本现算值与记录相等为准。
