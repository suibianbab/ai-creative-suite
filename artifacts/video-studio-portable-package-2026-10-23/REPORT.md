# Video Studio 可移植项目包 CLI 验证（2026-10-23）

分支：`codex/video-portable-package`，起点 `main@d5470be`。契约与互审入口见 [`artifacts/handoffs/VIDEO_PORTABLE_PACKAGE_CONTRACT_2026-10-23.md`](../handoffs/VIDEO_PORTABLE_PACKAGE_CONTRACT_2026-10-23.md)。本轮新增 CLI，不改 `VideoProject` schema、工作台 UI、媒体仓布局或出片脚本。

## 能力与使用

```powershell
node scripts/video/portable-project.mjs pack --project <项目.json> --out <新包目录> --store <源媒体仓绝对路径> [--style-bible <风格规范.json>]
node scripts/video/portable-project.mjs verify --bundle <包目录>
node scripts/video/portable-project.mjs restore --bundle <包目录> --store <目标媒体仓绝对路径> --out <新恢复目录>
```

未传 `--store` 时使用原 `ACS_MEDIA_STORE` / 默认用户媒体仓。`pack` 把原项目字节、引用的 Style Bible 和账本内全部 original 文件放入目录包；`manifest.json` 逐文件记录路径、大小与 SHA-256。`verify` 核对文件与引用，`restore` 安装到另一内容寻址仓并输出原项目字节及风格文件。既有同键文件必须全摘要相同才能复用；不同则拒绝覆盖。proxy、旁白音轨和历史渲染视频不在此包内。

## 实际验证

`node scripts/video/e2e-portable-project.mjs`：取仓库留存的真实 MP4，走现有媒体导入管线生成账本和源仓；CLI 做两组独立的 pack→verify→restore；从全新目标仓和恢复项目实际渲染横竖 MP4，ffprobe 核对 1280×720 / 720×1280。证据保存在忽略目录 `.tools/video-portable-e2e/run-XEFox3/`；重复运行会生成新的独立目录。

| 组别 | 背景 | 验证结果 | 横版 SHA-256 | 竖版 SHA-256 |
| --- | --- | --- | --- | --- |
| `styled` | 有 Style Bible，媒体版本留在历史、工作镜头为 spec | 包含媒体原件和风格文件；恢复后双画幅真实出片 | `40c38a7c2c9292167b8872600eeb458922919ad231a8ba4237af517f2f94fd0d` | `7c96fd713f3573e07d45ce0637472bb4be21241645d805bca22c031c7eaccf74` |
| `media` | 无 Style Bible，当前工作镜头是媒体片段 | 新仓出片；该版本两画幅 RenderRecord 的 `assetDigests` 均与原件 SHA-256 相同 | `12f2a63f1175125d7ced4af89973a8cfb605956f8a6e5deb8b2ed1d837f46e78` | `a7276a2e9b0122a9fe9c0d3c28b1c85b84fa5bfea3154bb8e9d3245cff800f5f` |

`Style Bible + 当前媒体工作镜头` 按产品现有 `workingStyleIssues` 契约会被拒绝，因为外部媒体颜色/灯光不能由该规范保证；新 CLI 在打包时就明确拒绝，e2e 已断言，避免“包成功、出片失败”。这也是两组验证分开的原因。

针对性单测 7/7：旧无媒体项目、媒体与风格往返、缺原件/错摘要/缺风格文件、包内篡改与 `../` 路径、目标仓同键冲突与输出目录存在、Style Bible/当前媒体不兼容，以及恢复目标落在包内的拒绝。`pnpm -r typecheck` 全工作区通过，Biome 检查 430 文件通过，`qa:validate` 为 98 automated / 53 manual；新登记 `VID-043`。

## 界限

- **已验证的是本地 CLI 跨目录/跨媒体仓恢复出片**。工作台浏览器导入整包、云端多租户上传、远端存储及服务端安全扫描尚未实现。
- 项目原文中的历史 `renderRecords.outputAssetRef` 和 `deliveries.outputRef` 仍指向旧出片位置；它们作为审计记录保留，不代表包里含历史 MP4/GIF/SVG。新环境应重新渲染。
- proxy 可重建，但恢复时不生成；含 proxy 元数据的项目在浏览器预览前还需补齐代理文件或改用原件。当前真实验收是 CLI 渲染。
- `editor-binding` 外部编辑器源不在现有媒体账本，包 CLI 明确拒绝这类项目。图片解说的 data URL 已内嵌项目 JSON，随项目保存。
- 路径和文件检查面向本地受信任 CLI，不宣称这是不可信网络压缩包解析器。
