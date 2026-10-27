# 交给 Codex：N1/N2/N3 复核

分支 `claude/video-next-n123`（基线 main@17e17e7，7 提交，HEAD 见 `git log`）。
交付自述与四态：`artifacts/video-studio-next-n123/REPORT.md`（含已知限制与你方重点的五点预答）。

## 复核范围

1. **N1 有声样片**（`artifacts/video-studio-semantic-narrated/`）：链路零改动，验收脚本 `scripts/video/e2e-semantic-narrated.mjs`。请核对：双画幅 MP4 音轨（ffprobe aac）、manifest 逐镜 narration.versionId 归属（不串镜）与 subtitleCues、确认卡旁白↔落库一致、逐镜字幕帧。
2. **N2 单镜修改**（主功能）：`/api/video/semantic-revise` + page/shot-editor-card UI + `scripts/video/e2e-semantic-revise.mjs`。证据在 `artifacts/video-studio-semantic-revise/`（before/after 导出、前后画面、report.json）。重点：版本语义（邻镜不变/+1 版本/parentVersionId）、锁定拒绝、冲突闸、保存重开、有声出片取新版本（manifest 对账）、失败面零改动。
3. **N3 新画面类型**：compare-split@2 / timeline-milestones@2 入受限 IR + `verifySourcedNumbers` 数值闸。证据在 `artifacts/video-studio-semantic-n3/`（双创意片+抽帧+check-layout 130 文本零碰撞）。

## 已知限制（先读，免重复提）

- 模型对含糊「阶段」表述可能选 flow（实测）；明确「用时间线展示」后稳定。
- 数值推导闸只认两数之差（纯数值，不解析单位）；汉字数字（"二十五"）不在闸内——prompt 纪律约束。
- N2 冲突闸只在确认时校验；生成期间镜头被改不影响候选预览（预览基于快照）。
- N3 样片未重复有声链（N1 已证，渲染/旁白机制相同）。

## 复跑

```bash
pnpm --filter @acs/web test        # 364/364
pnpm --filter @acs/web typecheck   # 通过
pnpm qa:validate                   # 117 自动用例
# 真实链（需 DASHSCOPE_API_KEY 的 dev server，端口用 BASE_URL 覆写）：
node scripts/video/e2e-semantic-narrated.mjs
node scripts/video/e2e-semantic-revise.mjs
node scripts/video/audit-semantic-n3-live.mjs
node artifacts/video-studio-semantic-n3/check-layout.mjs
```

计费台账：本轮真实千问+TTS 调用约 15 次（N1×1 轮 + N2 e2e×2 轮 + N3 审计×3 轮 + 探针），qwen-plus tokens 约 2 万；TTS 6 镜×2 轮。远低于 ¥50 预算。
