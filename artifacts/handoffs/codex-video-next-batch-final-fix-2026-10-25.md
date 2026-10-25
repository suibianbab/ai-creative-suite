# Video Studio `3411379` 后续修复交接

日期：2026-10-25。基线：`3411379`。本修复在独立 Codex 工作树完成，准备合并 main；原 Claude 工作树未改动。

## 修复

1. **工作台交互页安全边界**：导出前只接受 `orbit3d@1/@2`，参数键、形状、颜色与数值范围按注册表契约校验；内联脚本 JSON 再转义 `<` 等 HTML 脚本上下文字符。导入项目中的 `</script>` 参数会被拒绝，下载和交付账均不发生。
2. **多 3D 镜头选择**：工作台有两条以上 Three 镜头时必须明确选择镜头；导出和 `DeliveryRecord.versionIds` 指向选中镜头的工作版本。
3. **交互页 zoom**：衍生透视演示把 `zoom` 作用到相机距离，保持“值越大主体越小”的原 rig 方向。它仍是衍生演示，非出片正交相机的逐像素复刻。静态运行时 bundle 已按当前 `app.js` 重新生成。
4. **T1 3D 浏览器预览**：整片预览使用与 MP4 烘焙相同的 Three harness 生成横竖中段代表帧；切换画幅会重新取对应 PNG。只显示代表帧，动态以出片为准。
5. **E2E 自包含**：T3、W4 的确定性用例先从当前源码生成基线，再重建对比，避免旧 `.tools` 或留存 HTML 导致首次假红。

## 独立验证

- `pnpm --filter @acs/web test`：313/313；`pnpm --filter @acs/web typecheck`：通过；`pnpm exec biome check .`：478 文件通过；`node scripts/qa/run-regression.mjs validate`：113 自动/56 手工。
- `node scripts/video/e2e-t3-interactive-export.mjs`：空 `.tools` 初跑通过；W4 离线/iframe 与触屏模拟回归通过。
- `BASE_URL=http://localhost:3225 node scripts/video/e2e-three-preview-and-export.mjs`：横竖代表帧尺寸、双 Three 镜头明确选择、第二镜头 sphere/zoom=1.7 导出、离线 cameraDistance、SHA-256 对账、恶意参数拒绝且 deliveries 为空，全部通过（新增 VID-061）。
- `BASE_URL=http://localhost:3225 node scripts/video/e2e-t5-experience.mjs`：真实创建→编辑→转场→保存重开→双 MP4→工作台交互页入账，全链通过。
- `node scripts/video/t1-portrait-3d-verify.mjs`：v2 横竖主体比例 1.421/1.426；竖版代表帧第 36 帧与 MP4 在 1.5 秒抽帧的蓝色主体包围盒均为 `(233,512)-(486,767)`（720×1280）。

## 边界

- 3D 预览仅在本地开发环境提供，沿现有本地 MP4 渲染 API 的运行边界；需要 Playwright/Chromium 与 SwiftShader。生产部署若需 3D 预览，应部署受控渲染 worker。
- 静态代表帧验证构图；运动、转场和压缩效果以最终 MP4 审片为准。
- W4 真机触屏/NVDA 与 T4 新布局人工审片仍按既有挂账，不在本修复中冒充已通过。
