ALTER TABLE photocraft_edit_jobs
  ADD COLUMN params JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE photocraft_edit_jobs
  DROP CONSTRAINT photocraft_edit_jobs_operation_check;

ALTER TABLE photocraft_edit_jobs
  ADD CONSTRAINT photocraft_edit_jobs_operation_check
  CHECK (operation IN (
    'rotate-cw', 'rotate-ccw', 'rotate-180', 'flip-horizontal', 'flip-vertical',
    'duplicate-layer', 'hide-layer', 'show-layer',
    'adjust-brightness', 'adjust-contrast', 'adjust-saturation',
    'adjust-exposure', 'adjust-vibrance', 'adjust-shadows',
    'adjust-highlights', 'levels'
  ));
