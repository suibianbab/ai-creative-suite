# Video Studio 收口复核单：C1–C4 汇总与下一轮建议（2026-10-25）

分支 `claude/video-studio-closure`（基线 `5ac3375` ← `e3887df`；W2–W5 复核基线 `claude-video-studio-w2-w5-review.md` 保持独立）。本单供 Codex/用户独立复核：C1–C4 的提交范围、四态、未解决问题、人工待办、复跑入口，与下一轮候选工作包（只出方案，未实施）。

## 提交范围与结果一览

| 项 | 提交 | 交付 | 四态 | 结果文档 |
| --- | --- | --- | --- | --- |
| C1 服务端确认闸门 | `c9d9ce9`（+`cb0ce2e` 格式化） | render API 在真实出片前复验每条确认的三重绑定（内容版本/风格版本+digest/双画幅帧摘要），直连 POST 不再能绕过；旧项目（无确认）不拦截（503 探针锁定） | 代码✓/自动✓（web 310/310，RED 实拍绕过 200→GREEN 400）/真实 e2e✓（合法双画幅出片仍通过）/视觉 N-A | `claude-video-studio-c1-result.md` |
| C2 清单 v2 真实时间线+可用媒体 | `0257637`+`93f2c4e` | edit-list v2：转场合成窗口（与 render-manifest 逐字段一致）、编辑器限制说明、renderSources+逐镜切片方案（-frames:v，实测修正 -t 多包帧）、素材仓核验、v1 仍可读、out/源目录重叠拒绝 | 代码✓/自动✓（10/10，RED 8 失败）/真实✓（转场项目真渲+3 切片 ffprobe 核验+YAVG 证转场已烘进帧）/结构对照✓ | `claude-video-studio-c2-result.md` |
| C3 交互页触屏/可访问性/性能 | `9284875` | 触屏修复（spins 恒 0、多指劫持、touchCancel 卡死、双触检测含纪元配对两坑）、键盘+焦点+aria 播报、双渲染器性能口径 | 代码✓/自动✓（新 e2e PASS×3 + 旧 e2e 回归 PASS×3 含逐字节重建）/真实✓（CDP 触摸管线+有头 GPU 实测）/截图✓ | `claude-video-studio-c3-result.md` |
| C4 Blender 双画幅对照 | `bdbc144` | W3 环境门禁解除（便携 5.2.2 在位）；参数级同机位移植+双画幅关键帧/运动段/并排对照；实测成本与设备归因 | 代码✓/冒烟✓/真实渲染✓（48 帧运动+6 关键帧）/人工评分**留空待人工** | `claude-video-studio-c4-result.md` |

全仓门禁复跑（C4 渲染期间）：video-scene 189/189、video-document 163/163、web 310/310、`pnpm -r typecheck`、Biome 464 文件、`qa:validate` 105 自动/56 手工——全绿。

## 未解决问题（按重要性）

1. **Three 竖版 3D 拉伸映射**（C4 实测发现，产品层）：竖版 3D 镜头是把同一 16:9 正交视锥直接映射到 9:16 视口（内容宽高比 0.45 vs 横版 1.43，= 3.16× 纵向拉伸）。W3 spike 与 bake 链路现状如此。属产品缺陷候选，见建议 P-A。
2. **Blender 设备归因未决**：偏好显式勾选 OPTIX 后 GPU 峰值仍只 12-13%（采样未由 RTX 4060 承载），与 2026-10-09 同执行器的真实 OPTIX 速率（5.5s/帧）不符；嫌疑：驱动 595.95 差异或同期负载。C4 全部成本按实测 CPU 侧速率入账（横版 19.6s/帧）。环境复查前不宣称 Blender 路线 GPU 可用。
3. **W4 交互页真机触屏与读屏器实测**：模拟覆盖（CDP 触摸管线、aria DOM 断言）完成；真机/ NVDA 未测。
4. **W5/C2 编辑器真实往返**：仍待许可编辑器（v2 清单+切片+WAV 已备齐人工导入物）。
5. **W2 人工审片与人耳听审**：三套对照 + STEM 旁白（W2 挂账延续，本轮无新进展）。

## 人工待办

- C4 同机位对照评分表（`claude-video-studio-c4-result.md` 附录）——看 `compare-*-mid.png` 与两段 motion mp4 填分。
- C2 `MANUAL-ROUNDTRIP.md` 在许可编辑器执行（素材：`artifacts/video-studio-c2-2026-10-25/`）。
- W2 审片/听审（同前）。

## 复跑入口（全量）

```text
pnpm --filter @acs/video-scene test && pnpm --filter @acs/video-document test && pnpm --filter @acs/web test
pnpm -r typecheck && pnpm exec biome check . && node scripts/qa/run-regression.mjs validate
node --test scripts/video/export-edit-list.test.mjs                      # C2 10/10
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3220   # 升级提醒自中断就重跑同命令
BASE_URL=http://127.0.0.1:3220 node scripts/video/e2e-frame-approval.mjs   # C1 服务端闸门下的合法出片
node scripts/video/e2e-w4-interactive.mjs                               # C3 回归（离线 file://）
node scripts/video/e2e-w4-touch-a11y.mjs                                # C3 触屏/可访问性/双渲染器性能
node scripts/video/c4-blender-dual.mjs --smoke                          # C4 冒烟（需主检出 .tools 便携 Blender）
node scripts/video/c4-blender-dual.mjs --phase keys && node scripts/video/c4-blender-dual.mjs --phase motion   # C4 全量（分相可续跑）
```

## 下一轮候选工作包（≤3，有样片驱动；只出方案）

对照基线：程序化 SVG 出片（多镜头/字幕/旁白/双画幅）、转场合成、媒体混编、3D 两路线、交互样片、中立交换清单（v1→v2）。以下每包都有现成样片可直接驱动验收，不做无样片的新架构。

### P-A：竖版 3D 视锥修复（消除 3.16× 拉伸）

- **用户可见效果**：竖版 3D 镜头不再纵向拉伸变形，真 9:16 取景（主体比例与横版一致）；竖版出片可作为可交付素材。
- **复用模块**：`scripts/video/three/harness.js`（相机按画幅建视锥）、`orbit3d@1` rig（不改组件，改装配层）、W3 spike（`w3-three-golden-spike.mjs`）与 C4 的 bbox 度量脚本做回归对照。
- **最小验收样片**：重跑 W3 spike 竖版——bbox 内容宽高比从 0.45 恢复到与横版一致（方形像素），新旧并排图 + e2e 断言进回归；C4 Blender 竖版对照组（720×405 原像）可直接当"正确答案"参照。
- **预期限制**：改变既有竖版 3D 出片画面（对存量项目是视觉回归，需 renderRecord 版本口径确认）；仅影响 three 镜头，spec 镜头的竖版布局早已各自适配。

### P-B：转场工作台可视化编辑与 v2 清单联动

- **用户可见效果**：工作台时间轴上可加/改/删转场并即时预览 dip-to-black 借帧窗口（现在只有导出清单里有转场表示）；导出的 v2 清单与预览所见一致。
- **复用模块**：`transitions-draft.ts`/`resolveTransitionWindows`（帧数学已单一权威）、C2 edit-list v2 导出器、`render-scene` 转场透传、scene-preview。
- **最小验收样片**：C2 的 STEM-with-transition 项目（已入库）在工作台打开→加第二条转场→预览窗与出片帧一致（YAVG 曲线核验）→ v2 清单 transitions 与 render-manifest 逐字段一致（C2 已有断言链可扩）。
- **预期限制**：kind 仍只有 fade（schema 已留位）；预览是叠加近似，出片以合成为准（口径需写进 UI 文案）。

### P-C：工作台内"交互 3D 页"导出（W4 样片产品化）

- **用户可见效果**：任一 three 镜头可一键导出自包含交互页（拖转/拆解/键盘+读屏可用，≤8MiB、离线可开、可 iframe 嵌入）——给用户的「产品转起来看」交付物，与 MP4 出片并列。
- **复用模块**：W4 构建链（`w4-interactive-build.mjs` + C3 加固后的 `app.js`）、three 注册表与 `bake-three` 的 headless 链路、资产清单/许可入账格式。
- **最小验收样片**：取真实项目的一个 three 镜头导出交互页，跑 `e2e-w4-touch-a11y.mjs` 全套门禁（触屏/键盘/播报/双渲染器性能/8MiB/离线/iframe）全绿。
- **预期限制**：主体参数化=演示级材质（真实商品资产与打光超出）；单主体单交互（W4 形态）；导出页与出片 MP4 的画面一致性以 rig 参数对账，不做逐像素承诺。

## 复核提示（给 Codex）

按严重度建议优先看：①C1 闸门的绕过面（试构造新绕过：剥离 approvals、伪造摘要、并发出片期间的 active 标志）；②C2 校验器对恶意 v2 文档的拒绝面（超长 transitions、伪造 renderSources）；③C3 双击检测的边界（快速三连击、慢双击）；④C4 的设备归因（如有空窗可在本机复跑 `--phase motion` 观察 nvidia-smi）。
