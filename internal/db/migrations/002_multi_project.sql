-- Add project_id to layouts for per-project layout storage
ALTER TABLE layouts ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_layouts_project ON layouts(project_id) WHERE project_id IS NOT NULL;

-- Add ordering and appearance columns to projects
ALTER TABLE projects ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN color TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT;
