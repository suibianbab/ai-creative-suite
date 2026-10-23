# 模板创作体验线验收报告（2026-10-23）

## 范围与结论

按 `VIDEO_STUDIO_CODEX_CLAUDE_PARALLEL_PLAN_2026-10-23.md` §2 交付：新增「两房变三房 · 家装方案」（暖木家装 bible）与「换滤芯四步 · 设备操作」（蓝灰技术 bible）两个可编辑完整项目样片（各 5 镜头，16s / 16.5s，纯程序化镜头，无外部素材）；组件模板下拉新增一条静态预填语义提示（行为零变更，R1 裁决口径）。两个题材均完成浏览器全链路与双画幅真实出片。定位是可编辑样片起点，不宣称商业成片质量。

## 浏览器全链路（VID-043，`e2e-gallery-extensions.mjs`）

每题材：样片卡创建（5 镜头 + 挂链 Style Bible）→ 编辑组合镜头标题与第一条标注 → 显式保存 → 刷新重开（编辑持久）→ 横/竖预览切换（viewBox 断言 1280×720 / 720×1280）→ 回滚到样片版本；展开编辑器时断言预填语义提示可见；控制台零错误。`.tools/video-gallery-extensions-e2e/` 含 before/edited/reopened/rollback 四组 × 两题材项目 JSON、bible JSON 与预览截图；`browser-report.json` 汇总。修订仅进内存、持久化需点「保存」——e2e 已按此语义显式保存。

## 真实出片与审计（VID-044，`audit-gallery-extensions.mjs`）

`render-scene.mjs` 双题材双画幅 H.264、24 fps、无 TTS 音轨：

| 题材 | 帧/画幅 | 渲染记录 | 产物 |
| --- | --- | --- | --- |
| renovation | 384（16s×24） | 10（5 镜 × 2 画幅） | `renovation/render/*.mp4` |
| appliance | 396（16.5s×24） | 10 | `appliance/render/*.mp4` |

`render-audit.json` 断言编码、尺寸、帧数、frameMap 与 SHA-256，全部通过。项目 JSON、Style Bible、manifest 与逐镜中段抽帧（`keyframes/`，含横竖接片）留存本目录。

## 人工视觉检查（抽帧级）

逐镜中段帧共 20 张 + 4 张接片逐项检查：无标注/图示与文字重叠、无文字截断或被画幅裁断、背景对比充足、双画幅各自成立（竖版流程为纵向堆叠、数字镜头居中）。已知限制：竖版纯文字镜头上下留白偏大（与既有样片同类的版式取舍，非本轮回归）；renovation 镜 3 拆改线为实线渲染（line-drawing 无虚线参数，语义由标注文字补足）。抽帧检查不代表逐帧商业验收。

## 门禁

- `pnpm --filter @acs/web test` 279/279（新增 2 条样片用例）
- `pnpm --filter @acs/video-scene test` 179/179、`pnpm --filter @acs/video-document test` 158/158（无回归）
- `pnpm -r typecheck`、`pnpm exec biome check .`（426 文件）通过
- `node scripts/qa/run-regression.mjs validate`：99 自动 / 53 手工（含 VID-043/044）
- 兼容性：本线不改渲染链，旧 STEM 留样未触碰（无 schema/组件改动，不触发复渲门禁）

## 复跑

```text
BASE_URL=http://127.0.0.1:3212 node scripts/video/e2e-gallery-extensions.mjs   # 需本 worktree web
node scripts/video/audit-gallery-extensions.mjs                                # 需先出片
```

出片命令见 `render-manifest.json` 同目录日志；重跑 e2e 会生成新项目 ID，重渲染须以新的项目 JSON 为源。

## 未验证项

- TTS 旁白未生成（样片 `narrationText` 齐备，MP4 无声验证片）
- `next build` 在本 worktree 失败（安全提醒自中断环境问题，非本轮门禁；见交接单）
- 视觉验收为抽帧级检查；交互源、云端渲染不在本轮范围
