# Video Studio 收口第三轮问题修复

基线：`47ee4de`。在独立工作树的 `codex/video-closure-final-fix` 分支完成，未改 Claude 工作树或主检出的其他未提交文件。

## 修改

- `validateEditList` 将 v2 清单分为两种合法状态：纯编辑清单不含渲染源、切片计划及引用；可切片清单三者齐全，且每镜恰好覆盖 `aspects` 列出的全部画幅。源账本画幅集合、受限文件名、摘要、总帧与逐镜区间继续校验。
- 新增八类反例：缺某镜引用、删全部竖版、只留源与计划、只留计划、缺计划、空计划、重复画幅、空引用数组。调整旧伪造测试的合法基线，使其包含真实格式的切片计划。
- C4 报告按轴修复后的真实数据更新横竖运动帧时、CPU 探针及整卡 GPU 峰值；轴修复前的数据明确放入历史轮。脚本修正被跳过帧的计时统计，并改用 JSON 解析 Blender 设备列表，避免再写出空数组。没有重新渲染完整 144 帧。

## 验证

- `node --test scripts/video/export-edit-list.test.mjs`：15/15。
- `pnpm exec biome check scripts/video/export-edit-list.mjs scripts/video/export-edit-list.test.mjs scripts/video/c4-blender-dual.mjs`：通过。
- `node scripts/video/c4-blender-dual.mjs --smoke`：通过；背景精确，蓝色 10526 像素，金色 352 像素，竖向跨度 88 像素。
- `git diff --check`：通过。

仍未验证真实编辑器对 v2 清单的导入，也未在本轮重渲 Blender 全长视频。代表帧审批继续按已收窄的“选用的失效提醒”口径交付。
