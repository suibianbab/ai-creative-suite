# Claude 画面与模板线 · 交接单（2026-10-24）

绝对路径根目录：`D:\codex\animate\.claude\worktrees\stem-visual\artifacts\video-studio-stem-visual-2026-10-24\`
（`artifacts/` 在两轮交付中都属 gitignore，证据留盘上、以本绝对路径引用；分支代码已提交推送。）

## 基线与 HEAD

- 基线：`main@22ea60f`（含分工单基线 `db41d5b`）
- 分支：`claude/video-stem-visual`，worktree `D:\codex\animate\.claude\worktrees\stem-visual`
- HEAD：`ac16bc4`（merge-base `22ea60f`，3 个提交：组件扩展 → 几何修正 → Biome 格式化）
- 所有权遵守：只改了 `packages/video-scene/src/components/explainer-composition.ts`（+测试）与 `apps/web/src/app/video-studio/sample-gallery.ts`（+测试）。未触碰 `page.tsx`、`api/video/render/**`、`scripts/video/tts-*`、`qa/registry.json`、`CURRENT_STATE.md`、Codex 所有权文件与主检出未提交内容。`apps/web/next-env.d.ts` 的改动是 `next dev` 自动生成，未提交。

## 为什么扩展现有组件而不是新增注册组件（分工单要求的先行说明）

1. **flow 只能线性排布**：flow-steps 的横/纵等距盒子表达不了「蒸发→凝结→降水→汇流→回到蒸发」的闭环，也没有中心文字位；科学上水循环是闭环，总览镜头用环才准确。
2. **flow-diagram 无法竖版自适应**：它在 1000×1000 设计空间渲染，竖版 720×1280 被 letterbox 成 720×720 居中——这正是 2026-10-23 审片记录「竖版留白」的根因；只有 explainer-composition 已有竖版 1000×1778 viewBox 适配。
3. **drawing 无法给部件挂标注**：line-drawing 是纯路径，上一版降水镜全靠旁白/字幕解释（「图解说明过弱」）；需要一个能指向图示部件的小标签层。
4. **sketch-note 版式单一**：连续两镜同版式（「相邻镜头版式重复」）。
5. **不新增注册组件的额外理由**：新组件不在编辑器任何模板族内（编辑器按 componentId 分派），会破坏 `e2e-gallery.mjs` 对镜 2 `.composition-title-input` 的既有编辑流；对 `explainer-composition@1` 做加法扩展（新可选 `diagram.kind="cycle"` + 可选顶层 `diagramLabels`）让样片继续走已验证的 composition 编辑面与旁白复用链。registry 版本维持 8，旧 spec 渲染行为不变（回归测试全绿佐证）。

## 改了什么

`explainer-composition@1`（加法扩展，均向后兼容）：
- `diagram.kind: "cycle"`：3..6 阶段沿椭圆环顺时针排布，弧形箭头闭合成环（闭合弧错峰 +240ms），每阶段可带短注（caption ≤12 字），可选中心文字（≤10 字）。竖版把环沿 1778 设计空间纵向拉高（cy 540 / ry 410），横版收紧为 cy 530 / ry 200。时序：阶段 i 于 i×480ms 弹入、短注 +700ms、弧在两端落定后 380ms 描画 + 160ms 箭头、中心文字在环闭合后淡入。
- `diagramLabels`（仅可与 drawing 搭配，1..4 项）：`{text≤8, x, y, targetX?, targetY?, enterMs?}`，绘制在 drawing 设计空间内（随图示组整体变换，横竖同坐标），带目标时画细引线 + 端点圆。

`sample-gallery.ts` 的 stem 样片（镜头顺序、时长、旁白文本逐字不变——7 镜 26s 与 2026-10-23 完全一致，TTS 资产零成本复用）：

| 镜 | 组件/图示 | 目的 | 可编辑字段（浏览器） | 视觉限制 |
| --- | --- | --- | --- | --- |
| 1 开场 | text-animation | 提问引入 | 标题、副标题、时长、旁白文本 | 纯文字镜头，无图解（保留自上一版，审片未列为问题） |
| 2 总览 | composition **cycle** | 用闭环表达「水在海洋、天空、陆地间循环」的科学结构；竖版填满画幅 | 标题（composition-title-input）、标注文本；**阶段/短注/中心文字暂无专属编辑控件**，经参数透传保留（nodeTextColor 先例），改阶段需换模板或 JSON 导入 | cycle 在编辑器「图示类型」下拉外，UI 会显示图示类型为「图片」的文件入口（不触碰不影响）；这是不动 page.tsx/编辑器文件的代价 |
| 3 蒸发 | composition drawing + diagramLabels | 太阳/海面/水蒸气线描 + 部件标注，静音也可读懂 | 标题、线描路径（textarea）、标注；diagramLabels 参数透传不可直接编辑 | 线描为单一 strokeColor（Style Bible object 色），太阳与海面同色；标注位置固定在 drawing 空间 |
| 4 凝结 | sketch-note | 文字重点强调（与镜 3 版式区分） | 标题、条目、强调类型、时序 | 版式仍为组件固定排布（现在相邻镜头不再重复） |
| 5 降水 | composition drawing + diagramLabels | 云/雨线/海面 + 部件标注，解决「图示说明过弱」 | 标题、路径、标注 | 同镜 3 |
| 6 汇流 | composition flow（原 flow-diagram） | 降水→河流→海洋；竖版自动纵排且盒子更大（原 letterbox 留白消除） | 标题、流程步骤（textarea）、标注 | 3 步线性，节点位置不可自定义 |
| 7 收尾 | text-animation | 收束点题 | 标题、副标题 | 纯文字（保留） |

样片库描述更新为「环形总览＋分步图解」。

## 四态报告

1. **代码实现**：完成（上述两个文件 + 各自测试；`registryVersion` 仍为 8，无新组件）。
2. **自动回归**：通过。`@acs/video-scene` 184/184、`@acs/video-document` 158/158、`@acs/web` 281/281、`pnpm -r typecheck` 0 错、`pnpm exec biome check .` 干净、`node scripts/qa/run-regression.mjs validate` 通过（101 automated / 53 manual）。`qa/registry.json` 与 `CURRENT_STATE.md` 按分工规则留给集成时一次更新（暂定 `VID-048`）。
3. **真实浏览器与真实出片**：通过。
   - 浏览器闭环（自写脚本 `browser/` 下留证）：`BASE_URL=http://127.0.0.1:3215 node artifacts/video-studio-stem-visual-2026-10-24/e2e-acceptance.mjs` → PASS：样片创建 7 镜 → 改文案（镜 1 标题）+ 改图示（镜 2 cycle 标题、镜 3 线描路径）→ 保存 → 刷新重开 → 镜 3 回滚到原始版本（编辑历史保留在工作版本切换里）；控制台/页面错误 0。截图 `browser/01-created.png`…`04-rolled-back.png`，项目 JSON `browser/02-edited…04-rolled-back.video-project.json`。
   - 标准链路：`BASE_URL=http://127.0.0.1:3215 SAMPLE_ID=stem node scripts/video/e2e-gallery.mjs` → failures 0（含双画幅预览、无声双 MP4 与台账回写）。
   - 有声双画幅：`node scripts/video/render-scene.mjs --project …render/stem-edited.video-project.json --style-bible …render/stem.style-bible.json --narration …narration --out …render` → 624 帧干跑双画幅通过，横竖各 26.005s H.264+AAC；7 份 WAV+字级时间戳按「旁白文本逐字一致」断言复用（`reuse-narration.mjs`），**零新 TTS 计费**。审计 `audit.mjs` PASS：横 `sha256=4d681bac2ca13b8c5a015fbc7493bd8f0c4636171ce00f5b880c41570c047402`（1,446,525 B）、竖 `sha256=bfa706d7274b752371abe710e31f3647a6b5ac0904a591b9190252db96196ded`（1,435,009 B），台账 7+7 条。
4. **视觉质量**：见下节与「不满意之处」。**不宣称商业级画质**；相对 2026-10-23 版的三项指名问题（竖版留白 / 相邻版式重复 / 图解说明过弱）均已针对性解决并有证据。

## 视觉质量证据与检查

- 逐镜早/中/晚帧：`keyframes/landscape-1-early.png` … `portrait-7-late.png`（42 帧）；总览 `keyframes/contact-late.png`、`keyframes/contact-all.png`。
- 确定性布局校验 `check-layout.mjs`：LAYOUT OK（8 组 = 4 改动镜 × 2 画幅，可见文本无出界、无两两包围盒相交；开发迭代中还抓出并修复了横版环底短注与底标注重叠的真实问题）。
- 字幕遮挡抽查（视觉模型）：横版镜 2 字幕带 y≈690–710 与标注「太阳能驱动这趟旅程」间隔 ~35px 无遮挡；竖版镜 5 字幕带 y≈1180–1230 低于全部图示/标注，引线指向明确。
- 音画衔接（结构化）：7 镜旁白 2680/3960/3880/3240/3800/3640/2280ms 均严格小于镜头时长（3000/4000×5/3000），无溢出无截断；字幕 cue 2/3/2/2/2/2/2 与旁白句读一致。**尚未做独立人耳听审**（与上一版相同边界；音轨编码、时长与 cue 已量化核对）。
- 镜头节奏（人工）：开场 3s 文字 → 4s 环形总览（阶段弹入→弧线闭合→中心文字三段节奏）→ 蒸发图解 → 凝结手写 → 降水图解 → 汇流流程 → 收尾，相邻镜头不再同版式；逐镜动效时序见 keyframes/contact-all.png 的 early/mid/late 对比。

## 不满意之处 / 遗留

1. **cycle 阶段与 diagramLabels 无专属编辑控件**：编辑器「图示类型」对 cycle 显示成「图片」入口（不触碰不破坏数据，标题/路径/流程步骤仍可编辑）。根因是编辑器模板族文件不在本轮所有权内；建议集成轮补一个 cycle 分支（给 flow-templates 或 composition 面板）。
2. **镜 2 cycle 的 caption 在竖版离标题较近、在横版偏小**（22 设计字号）；手机端可读性靠竖版更大的盒子弥补，未做真机检查。
3. **线描单色**：太阳/海面/水蒸气共用 Style Bible object 色，缺少第二强调色通道（需组件级多色支持，超出本轮）。
4. **未做人耳听审与真机（手机）播放检查**；沿用结构化核对的证据边界。
5. 镜 1/7 保持纯文字开场收尾（上轮已审过，本轮未动）；若要拉满质量可考虑给开场加视觉元素。
6. `artifacts/` 目录不入库（沿用既往交付惯例），证据只在本机绝对路径下。

## 复跑（在 worktree `D:\codex\animate\.claude\worktrees\stem-visual`）

```text
pnpm --filter @acs/video-scene test          # 184/184
pnpm --filter @acs/web test                  # 281/281（含样片结构/旁白逐字断言）
pnpm -r typecheck && pnpm exec biome check .
pnpm --filter @acs/web exec next dev --hostname 127.0.0.1 --port 3215   # 升级自中断就重跑同命令
BASE_URL=http://127.0.0.1:3215 node artifacts/video-studio-stem-visual-2026-10-24/e2e-acceptance.mjs
BASE_URL=http://127.0.0.1:3215 SAMPLE_ID=stem node scripts/video/e2e-gallery.mjs
node artifacts/video-studio-stem-visual-2026-10-24/reuse-narration.mjs
node artifacts/video-studio-stem-visual-2026-10-24/audit.mjs
node artifacts/video-studio-stem-visual-2026-10-24/check-layout.mjs
node artifacts/video-studio-stem-visual-2026-10-24/extract-keyframes.mjs
```

注意：3210 端口已被某个非本 worktree 的旧 server 占用（返回 200 但跑的是别处代码），本轮用 3215；**没有动那个进程**，集成时请先确认 3210 归属再复用或关闭。

## 需要用户输入的问题

无阻断性输入需求。两个可选决策点（不决策不影响本轮验收）：
- 是否要我在集成轮给 cycle/diagramLabels 补编辑器控件（需改 `flow-templates.ts`/`shot-editor-card.tsx`，超出本轮所有权，需与 Codex 协调文件归属）。
- 3210 端口旧 server 的处置（属主确认后关闭或保留）。

## 下一条命令（恢复入口）

```text
cd D:\codex\animate\.claude\worktrees\stem-visual && git log --oneline main..HEAD
# 集成轮：在本 worktree 复跑上面的测试块；渲染证据在 artifacts/video-studio-stem-visual-2026-10-24/
```

## 对 Codex `codex/video-narrated-workbench@7658abd` 的互审意见

见独立文件：`D:\codex\animate\.claude\worktrees\stem-visual\artifacts\video-studio-stem-visual-2026-10-24\codex-review.md`（按分工单只给意见、不改那条分支）。
