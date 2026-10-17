-- M4 批量配方（通用语言指令方案 §12.3）：一张图上经确认环通过的动作列表，
-- 一键套到整个目录；计费按张入账本，质量门抽样复检。
-- batch-recipe 作业的 params.steps 携带 1–4 个整图操作（apps/api 侧白名单）。
ALTER TABLE photocraft_edit_jobs DROP CONSTRAINT photocraft_edit_jobs_operation_check;
ALTER TABLE photocraft_edit_jobs ADD CONSTRAINT photocraft_edit_jobs_operation_check
CHECK (operation IN (
  'rotate-cw', 'rotate-ccw', 'rotate-180', 'flip-horizontal', 'flip-vertical',
  'duplicate-layer', 'hide-layer', 'show-layer',
  'adjust-brightness', 'adjust-contrast', 'adjust-saturation',
  'adjust-exposure', 'adjust-vibrance', 'adjust-shadows', 'adjust-highlights', 'levels',
  'masked-adjust-brightness', 'masked-adjust-contrast', 'masked-adjust-saturation',
  'masked-adjust-exposure', 'masked-adjust-vibrance', 'masked-adjust-shadows',
  'masked-adjust-highlights', 'generate-local', 'batch-recipe'
));

-- 批量状态聚合：同一 requestKey 跨项目的作业清单（计费与抽样复检报告）。
CREATE INDEX photocraft_edit_jobs_batch_idx
  ON photocraft_edit_jobs (organization_id, workspace_id, request_key, created_at)
  WHERE operation = 'batch-recipe';
