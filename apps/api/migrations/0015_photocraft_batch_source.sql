-- P2-2 整改（codex 审核 2026-10-16）：批量配方的来源确认闭环。批次记录补上
-- 可追溯来源——单图确认时的源项目、确认所依据的不可变版本、确认人与确认
-- 时间。入队时校验源项目当前版本仍与确认版本一致，防止把过期确认的配方
-- 套到目录上。0015 之前的批次行没有来源（列保持 NULL，不回填猜测值），
-- 这些行的重放继续走 0014 的作业行比对路径。
ALTER TABLE photocraft_batch_requests
  ADD COLUMN source_project_id uuid,
  ADD COLUMN source_version integer,
  ADD COLUMN confirmed_by uuid,
  ADD COLUMN confirmed_at timestamptz;
