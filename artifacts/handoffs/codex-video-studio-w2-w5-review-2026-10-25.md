# Codex 复核：Claude Video Studio W2–W5

日期：2026-10-25。对象：`claude/video-studio-w2-w5` 的 `be77030..e3887df`。本轮只读审核原交付分支；测试曾重写的样片产物已恢复，原工作树保持干净。后续 `claude/video-studio-closure` 的 C1–C5 是独立修复分支，**不计入本轮结论**。

## 结论

W2 的编辑器体验和版本失效判断、W4 的离线交互样片已经有可复现证据；W3 的 Blender 路线和 W5 的编辑器往返如实标为未验证。W2 的导出确认仍可被绕过，W5 的清单时间线在合法时长下可与实际出片不一致，因此尚不建议将 W2/W5 的完整产品承诺标为通过。W4 是演示样片，不代表真实商品或真机性能验收。

## 必修问题

1. **[P1] 确认闸门只拦工作台按钮，且清空确认列表即可放行。** `apps/web/src/app/video-studio/page.tsx:201-212` 仅在客户端执行 `approvalStatus`；`frame-approval.ts:106-111` 在确认数组为空时返回 `valid: true`。浏览器直连渲染 API/CLI 可跳过检查，已有确认的项目也能移除当前态确认记录后从工作台导出。原 W2 目标为确认代表帧后再出整片。修复时必须在可信导出入口校验服务端加载的项目、内容及风格版本；为旧项目设明确兼容口径，不能仅信请求中的布尔值或客户端状态。C1 已列入后续任务，但本轮原交付仍未满足。
2. **[P1] W5 每镜单独四舍五入，违反权威出片的累计边界量化。** `scripts/video/export-edit-list.mjs:29-36` 使用 `Math.round(durationMs/1000*fps)`，而 `render-scene.mjs:247-250` 调用 `quantizeTimeline`，其契约见 `packages/video-document/src/quantize.ts:19-26`。合法三镜各 101ms、24fps：清单给 2+2+2=6 帧；实际累计边界是 2、5、7，共 7 帧。现有七镜 STEM 样本的时长恰好没有触发差异，测试只断言清单自身无缝而未与真实出片帧区间对账。应共用 `quantizeTimeline` 并加入非整帧时长回归。
3. **[P2] W5 允许无效帧率写出看似合法的清单。** CLI `--fps` 只经 `Number()` 转换，`buildEditList`/`validateEditList` 未检查有限正数和整数帧边界。实测把七镜样本裁成单镜后 `buildEditList(project,{fps:NaN})` 返回 `fps=NaN/endFrame=NaN`，`validateEditList` 仍返回 `true`；序列化 JSON 后两者成为 `null`。见 `export-edit-list.mjs:97-113,145-151`。应使用权威量化函数并校验 fps、区间整数与递增关系；坏参数非零退出且无成功文件。
4. **[P2] W5 清单目前不能单独交付给编辑器使用。** `export-edit-list.mjs:42-55,154-158` 只把旁白文件名/摘要写入 JSON，`--out` 仅写 `edit-list.v1.json`，没有把引用的 WAV、字级时间戳或镜头媒体作为可读取交付资产复制/打包，也没有逐镜可导入媒体。报告已如实声明真实往返未验证，但“可供后续视频生产”的交付仍需实测可解析路径、内容摘要、逐镜片段或受支持的切片方式。C2 可在不假称编辑器往返的前提下完成可用素材包。

## 范围与证据口径

- **W2：部分通过。** Web 306/306 测试通过；帧生成、派生版本与失效提示有浏览器证据。导出强制门禁未闭合；三套对照的人工审片和人耳听审仍待人工。`renderApprovalFrames` 还用单镜 `Math.ceil` 选中段帧（`frame-approval.ts:52-53`），而整片出片用累计量化；应让代表帧选择与实际 span 同源，以免非整帧时长出现帧位偏差。
- **W3：仅 Three 路线通过样片验证。** Blender 协议是设计/复跑说明，不是实际两路线质量对照；不能据此决定商品广告的路线或质量上限。
- **W4：演示样片通过。** 独立复跑 `node scripts/video/e2e-w4-interactive.mjs` 为 PASS，file://、拖转、拆解、iframe 和重建检查可用。测试的 FPS 是页面 `requestAnimationFrame` 次数（`e2e-w4-interactive.mjs:68-84`），不等于 WebGL 实际渲染帧率；触屏和真机未测。报告应保留这一限制，C3 可补测。
- **W5：清单原型通过，生产交换未通过。** 独立复跑 `node --test scripts/video/export-edit-list.test.mjs` 为 3/3；测试使用的样本时长无法暴露累计量化差异。实际编辑器导入、修改、重开、再导出未验证。
- `pnpm --filter @acs/web test -- frame-approval.test.ts` 在该仓库实际跑完整 Web 测试集合，结果 306/306 通过。上述问题是当前测试覆盖不到的契约缺口，不因现有测试为绿而自动消除。

## 建议复核顺序

先检查 C1 对 W2 服务端闸门与清空确认绕过的处理，再检查 C2 与权威帧量化/可用素材包，随后看 C3 测量口径、C4 Blender 实测。每项都应在新分支上带反例测试、实际导出证据和旧项目兼容说明；原 `e3887df` 不要改写。
