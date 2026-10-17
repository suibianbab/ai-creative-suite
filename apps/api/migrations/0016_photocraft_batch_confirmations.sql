-- R1（codex 第二轮复审 2026-10-16）：批量配方的服务端确认快照。
-- 「确认一次，套全目录」的「确认」必须有不可变服务端记录：源项目/版本、
-- 规范化步骤与摘要、确认人与真实确认时间。批量入队只能引用该记录并核验
-- 其仍有效——直接随请求提交任意 steps+source 不再被认作已确认配方；
-- batch_requests.confirmed_by/confirmed_at 改为从该记录复制（原始单图确认
-- 时间，而非批量入队时间）。
CREATE TABLE photocraft_batch_confirmations (
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  id uuid PRIMARY KEY,
  source_project_id uuid NOT NULL,
  source_version integer NOT NULL,
  steps jsonb NOT NULL,
  steps_digest text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  confirmed_by uuid NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX photocraft_batch_confirmations_ws_idx
  ON photocraft_batch_confirmations (organization_id, workspace_id, confirmed_at DESC);

-- 批次记录回指确认快照：GET 状态可追溯到同一配方摘要与原始确认时间。
ALTER TABLE photocraft_batch_requests ADD COLUMN confirmation_id uuid;
