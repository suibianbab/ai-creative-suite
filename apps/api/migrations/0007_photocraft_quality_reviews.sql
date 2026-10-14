CREATE TABLE photocraft_quality_reviews (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  source_version INTEGER NOT NULL,
  reviewer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  request_sha256 CHAR(64) NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('ready','minor','manual','unsuitable')),
  note TEXT NOT NULL CHECK (length(note) <= 2000),
  checks JSONB NOT NULL,
  criteria JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, workspace_id, project_id, source_version, request_key),
  FOREIGN KEY (organization_id, workspace_id, project_id, source_version)
    REFERENCES photocraft_project_versions(organization_id, workspace_id, project_id, version) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(checks) = 'array' AND jsonb_array_length(checks) = 4),
  CHECK (jsonb_typeof(criteria) = 'array' AND jsonb_array_length(criteria) = 4)
);

CREATE INDEX photocraft_quality_reviews_latest_idx
  ON photocraft_quality_reviews (organization_id, workspace_id, project_id, source_version, created_at DESC, id DESC);

CREATE TRIGGER photocraft_quality_reviews_no_mutation BEFORE UPDATE OR DELETE ON photocraft_quality_reviews
  FOR EACH ROW EXECUTE FUNCTION reject_image_project_version_mutation();
