-- P2-1 整改（codex 审核 2026-10-16）：批量请求的完整规范化内容与跳过结果
-- 落库。此前重放只对比已建作业行的 project_id 集合——包含跳过项目的批次在
-- 重放时缺失项无法与「同键不同内容」区分，既误报冲突又丢失 skipped 清单。
CREATE TABLE photocraft_batch_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  request_key text NOT NULL,
  -- 规范化后的完整请求项目清单（排序去重），重放按此比对原请求内容。
  project_ids jsonb NOT NULL,
  -- 与作业行相同的规范化配方（键序无关比对见 canonicalJson）。
  params jsonb NOT NULL,
  -- 首次入队时的跳过清单：同键同内容重放原样返回，语义与首次一致。
  skipped jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, request_key)
);
