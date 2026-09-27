-- 保留原业务可见性；平台镜像与业务通过授权关系关联，不再存在项目所有者。
CREATE TABLE runtime_environment.image_project_grants (
  image_id text NOT NULL REFERENCES runtime_environment.images(id),
  project_id text NOT NULL,
  PRIMARY KEY(image_id, project_id)
);
INSERT INTO runtime_environment.image_project_grants(image_id, project_id)
  SELECT id, project_id FROM runtime_environment.images;
ALTER TABLE runtime_environment.images ADD COLUMN default_visible boolean NOT NULL DEFAULT false;
UPDATE runtime_environment.images SET default_visible = (scope = 'shared');

-- 来源与初始化 Secret 约束留在不可变配方中；原 recipeDigest 不重算。
UPDATE runtime_environment.revisions SET payload = payload
  || jsonb_build_object('sourceProjectId', (SELECT project_id FROM runtime_environment.images WHERE id = image_id))
  || CASE WHEN jsonb_array_length(COALESCE(payload->'initializer'->'secrets', '[]'::jsonb)) > 0
       THEN jsonb_build_object('initializerProjectId', (SELECT project_id FROM runtime_environment.images WHERE id = image_id)) ELSE '{}'::jsonb END;
UPDATE runtime_environment.builds SET payload = payload || jsonb_build_object('sourceProjectId', project_id);
UPDATE runtime_environment.images SET payload = (payload - 'projectId' - 'scope') || jsonb_build_object('defaultVisible', default_visible);
UPDATE runtime_environment.versions SET payload = payload - 'projectId';
ALTER TABLE runtime_environment.images DROP COLUMN project_id, DROP COLUMN scope;
ALTER TABLE runtime_environment.versions DROP COLUMN project_id;
-- project_id 只保留旧 builder 的资源归属；新构建的来源在 payload.sourceProjectId。
ALTER TABLE runtime_environment.builds ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE runtime_environment.creation_requests RENAME COLUMN project_id TO request_scope;
CREATE INDEX image_default_page ON runtime_environment.images(default_visible, id DESC);
