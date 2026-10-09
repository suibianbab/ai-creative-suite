CREATE TABLE local_image_imports (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 1 AND 128),
  source_project_id UUID NOT NULL,
  source_sha256 CHAR(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  destination_project_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (organization_id, workspace_id, request_key),
  FOREIGN KEY (organization_id, workspace_id)
    REFERENCES workspaces(organization_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION enforce_local_image_import_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Local image import records are retained' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.request_key IS DISTINCT FROM OLD.request_key
    OR NEW.source_project_id IS DISTINCT FROM OLD.source_project_id
    OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.destination_project_id IS DISTINCT FROM OLD.destination_project_id
    OR OLD.completed_at IS NOT NULL
    OR NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'Invalid local image import transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER local_image_import_transition BEFORE UPDATE ON local_image_imports
  FOR EACH ROW EXECUTE FUNCTION enforce_local_image_import_transition();

CREATE TRIGGER local_image_import_no_delete BEFORE DELETE ON local_image_imports
  FOR EACH ROW EXECUTE FUNCTION enforce_local_image_import_transition();
