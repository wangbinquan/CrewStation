-- 2026-09-24 裁定（RFC-003 §3 修订）：可见范围同时决定网关放谁打开正式地址，「项目成员与指定用户」一档取消。
-- 原指定用户迁成「用户」角色成员；已经是成员的保留原角色。
INSERT INTO project.memberships (project_id, user_id, role)
SELECT project_id, jsonb_array_elements_text(user_ids), 'user'
  FROM project.app_listings
 WHERE mode = 'selected'
ON CONFLICT (project_id, user_id) DO NOTHING;
UPDATE project.app_listings SET mode = 'members' WHERE mode = 'selected';
ALTER TABLE project.app_listings DROP CONSTRAINT app_listings_mode_check;
ALTER TABLE project.app_listings ADD CONSTRAINT app_listings_mode_check CHECK (mode IN ('members', 'authenticated'));
ALTER TABLE project.app_listings DROP COLUMN user_ids;
-- 没有使用权的人能否在工作台申请；新旧应用默认允许。
ALTER TABLE project.app_listings ADD COLUMN allow_requests boolean NOT NULL DEFAULT true;

-- 应用使用申请：批准即加为「用户」角色成员，一次裁决后不可更改。
CREATE TABLE project.app_access_requests (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  requested_by text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'approved', 'rejected')),
  reason text,
  decided_by text,
  decision text,
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);
-- 同一人对同一应用最多一条待处理的申请。
CREATE UNIQUE INDEX app_access_requests_pending_uq ON project.app_access_requests (project_id, requested_by) WHERE state = 'pending';
CREATE INDEX app_access_requests_state_idx ON project.app_access_requests (state, created_at DESC, id DESC);
CREATE INDEX app_access_requests_project_idx ON project.app_access_requests (project_id, created_at DESC, id DESC);
CREATE INDEX app_access_requests_requester_idx ON project.app_access_requests (requested_by, project_id, created_at DESC);
