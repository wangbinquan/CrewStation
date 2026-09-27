ALTER TABLE project.app_listings ADD COLUMN icon_source jsonb NOT NULL DEFAULT '{"kind":"app"}'::jsonb;
CREATE TABLE project.app_icons (
  project_id text PRIMARY KEY REFERENCES project.projects(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (length(content) <= 87384),
  mime text NOT NULL CHECK (mime = 'image/webp')
);
