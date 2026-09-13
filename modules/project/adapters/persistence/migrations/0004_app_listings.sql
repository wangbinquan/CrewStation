CREATE TABLE project.app_listings (
  project_id text PRIMARY KEY,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'station',
  mode text NOT NULL DEFAULT 'members' CHECK (mode IN ('members', 'authenticated', 'selected')),
  user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz
);
-- 只建立市场展示默认值；不改成员、网关、生产访问或 APIGrant。
INSERT INTO project.app_listings (project_id)
SELECT id FROM project.projects WHERE kind = 'DigitalWorker';
