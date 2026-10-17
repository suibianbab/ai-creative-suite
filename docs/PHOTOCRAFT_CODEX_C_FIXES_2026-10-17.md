# Codex 对第六轮 C 项复核后的修正（2026-10-17）

本文供 Claude 复核。工作区原有未提交改动属于此前 M2～M4 交付；本次只修正第六轮 C 项的候选蒙版确认链路、评测口径及对应说明，随此前交付一并提交。

## 1. 候选确认的异步状态

- `apps/web/src/app/image-studio/photocraft/page.tsx`：增加同步 ref 锁，避免 React 状态更新前连续点击启动多次蒙版上传。候选按钮、画面上的候选框、画图指针、清除选区、选区来源切换和预览按钮在准备期间不可操作；预览函数自身也用 ref 守卫。
- 确认时记下编辑上下文版本和源文件引用；异步上传完成后如果图片或指令已经变化，不再把旧蒙版 id、选区方法或提示写回新上下文。切换项目的重置路径明确清空 `candidateMaskId`。
- 请重点复核：快速连点两个候选、上传期间修改指令、上传期间切换图片/项目，最终选区来源是否始终与当前候选一致。

## 2. 桥端蒙版失效后的套索回退

- `executeInstructionStep` 仅在桥返回包含“候选蒙版”的错误且已有至少三个轮廓点时，以 `manual` 选区法、同一原图和计划重试一次；其他错误原样报出，重试失败也如实报错。成功时返回 `selectionFallback:"outline"`，预览消息明确告知使用了套索。
- 状态更新放在检查当前编辑上下文版本之后，避免旧请求在新项目里切换选区。多步骤编辑发生回退后，余下步骤沿用 `manual`，最终统一更新页面状态。
- `apps/web/src/app/image-studio/photocraft/candidate-mask.ts` 的纯函数限定回退条件；对应测试覆盖蒙版错误、轮廓不足、无关错误。
- 请重点复核：人为让已上传的蒙版 id 失效或让蒙版尺寸与源文件不符，预览是否自动生成套索结果；普通 PhotoCraft 编辑失败是否不会被套索重试掩盖。

## 3. 浏览器蒙版像素与 IMG-054 口径

- 浏览器先平滑缩放服务蒙版，再把 `ImageData` 的 RGB **实际写成 0/255** 并 `putImageData`，之后才 `toBlob` 上传。此前代码只计数阈值以上像素，上传的仍是含中间灰阶的图，与 IMG-054 的 ≥128 二值指标不一致。
- `candidate-mask.test.ts` 新增阈值两侧写回测试。
- `scripts/photocraft/mask-quality-eval.mjs` 的说明和原整改文档改为准确口径：IMG-054 Part 2 是 GT 蒙版→桥→PhotoCraft 的集成测试，**不经过真实浏览器**。E 项浏览器点击验证仍待做；不能把桥端 PASS 写成浏览器 PASS。

## 4. GT 文件格式校验

- `mask-quality-eval.mjs` 在转换前读取 PNG 元数据，要求 8bit 单通道灰度，再直接读取原像素检查仅有 0/255。此前先 `.grayscale()` 再检查单通道，RGB 原文件也会通过该项。

## 已执行验证

- Web TypeScript `tsc --noEmit` 通过；相关文件 Biome 检查通过。
- `candidate-mask.test.ts` 与 `candidate-ring.test.ts` 共 14/14 通过。
- `node scripts/photocraft/mask-quality-eval.mjs --case 帽沿` 通过：mask IoU 0.9532；桥接编辑、保存重开及范围外像素检查通过。该子集报告写入 `.tools/photocraft-serve-qa/mask-quality-report.subset.json`，不覆盖全量报告。

## 仍需独立验收

- E 项真实浏览器点击→候选确认→预览回退场景尚未执行；上述代码修正和自动测试不能代替此项。
- IMG-054 全量低质量发现仍在：12 个 GT 目标只有 5 个 mask IoU ≥0.5；`TAU_AUTO_ENABLED=false` 保持关闭，商业视觉质量未宣称达标。
