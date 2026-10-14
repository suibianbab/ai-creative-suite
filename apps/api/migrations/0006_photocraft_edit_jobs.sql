CREATE TABLE photocraft_edit_jobs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  request_sha256 CHAR(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  expected_version INTEGER NOT NULL CHECK (expected_version >= 1),
  input_source_asset_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('rotate-cw', 'rotate-ccw', 'rotate-180', 'flip-horizontal', 'flip-vertical')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  lease_token UUID,
  output_version INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (organization_id, workspace_id, project_id, request_key),
  FOREIGN KEY (organization_id, workspace_id, project_id)
    REFERENCES photocraft_projects(organization_id, workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, workspace_id, input_source_asset_id)
    REFERENCES assets(organization_id, workspace_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'running') = (lease_token IS NOT NULL)),
  CHECK (status <> 'succeeded' OR output_version IS NOT NULL)
);

CREATE INDEX photocraft_edit_jobs_claim_idx
  ON photocraft_edit_jobs (available_at, created_at)
  WHERE status IN ('queued', 'running');

CREATE INDEX photocraft_edit_jobs_workspace_idx
  ON photocraft_edit_jobs (organization_id, workspace_id, project_id, created_at DESC);
