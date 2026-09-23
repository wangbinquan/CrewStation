-- RFC-025 资源中心台账（设计 §3）：一条平台资源一行；子对象、变更日志、租约、别名、项目额度锁各一张表。
CREATE TABLE resources.records (
  id text PRIMARY KEY,
  kind text NOT NULL,
  project_id text,
  owner_module text NOT NULL,
  owner_ref text NOT NULL,
  parent_id text,
  purpose text,
  desired text NOT NULL CHECK (desired IN ('present', 'absent')),
  spec jsonb NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  observed_generation integer NOT NULL DEFAULT 0,
  release_reason jsonb,
  -- 实况里除阶段与时间以外的部分：条件、启动进度、原因、展示字段。
  status jsonb NOT NULL DEFAULT '{}'::jsonb,
  phase text NOT NULL CHECK (phase IN ('pending', 'provisioning', 'starting', 'ready', 'degraded', 'stopping', 'stopped', 'failed')),
  phase_since timestamptz NOT NULL,
  idle_since timestamptz,
  retain_until timestamptz,
  version bigint NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  compacted_at timestamptz
);
CREATE UNIQUE INDEX records_owner_idx ON resources.records (owner_module, owner_ref, kind);
CREATE INDEX records_project_kind_phase_idx ON resources.records (project_id, kind, phase);
CREATE INDEX records_parent_idx ON resources.records (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX records_retain_idx ON resources.records (retain_until) WHERE retain_until IS NOT NULL;
CREATE INDEX records_live_idx ON resources.records (phase) WHERE phase NOT IN ('stopped', 'failed');

-- 子对象：期望里的（expected）与期望里已没有、但集群里还在的旧对象。一个集群对象只属于一条记录。
CREATE TABLE resources.children (
  resource_id text NOT NULL REFERENCES resources.records (id) ON DELETE CASCADE,
  kind text NOT NULL,
  namespace text NOT NULL DEFAULT '',
  name text NOT NULL,
  uid text,
  expected boolean NOT NULL DEFAULT true,
  observed jsonb,
  observed_at timestamptz,
  PRIMARY KEY (resource_id, kind, namespace, name)
);
CREATE UNIQUE INDEX children_object_idx ON resources.children (kind, namespace, name);
CREATE UNIQUE INDEX children_uid_idx ON resources.children (uid) WHERE uid IS NOT NULL;

-- 变更日志：推送流与续传的来源，只追加。seq 在提交时由延迟触发器按提交顺序盖上，
-- 所以尾随器按 seq 读永远不会跳过一个晚提交的早序号（设计 §8.2）。
CREATE SEQUENCE resources.change_seq;
CREATE TABLE resources.changes (
  id bigserial PRIMARY KEY,
  seq bigint UNIQUE,
  project_id text,
  resource_id text NOT NULL,
  version bigint NOT NULL,
  change text NOT NULL CHECK (change IN ('upsert', 'remove')),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX changes_project_seq_idx ON resources.changes (project_id, seq);
CREATE INDEX changes_at_idx ON resources.changes (at);

CREATE FUNCTION resources.stamp_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- 提交前一刻取全局咨询锁再取序号：锁到提交结束才放，序号顺序就是提交顺序。
  PERFORM pg_advisory_xact_lock(hashtext('resources.change_seq'));
  UPDATE resources.changes SET seq = nextval('resources.change_seq') WHERE id = (NEW).id;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER changes_stamp AFTER INSERT ON resources.changes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION resources.stamp_change();

-- 调和器的分工（设计 §6.3）：处理一条资源前抢这一行，持有期内续约。
CREATE TABLE resources.leases (
  resource_id text PRIMARY KEY,
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- 旧形状对象的别名（rel_…、tsk_…、旧 PVC 名、旧路由名）：按别名能找回记录，记录本身只用 UUID。
CREATE TABLE resources.aliases (
  source text NOT NULL,
  alias text NOT NULL,
  resource_id text NOT NULL REFERENCES resources.records (id) ON DELETE CASCADE,
  PRIMARY KEY (source, alias)
);
CREATE INDEX aliases_resource_idx ON resources.aliases (resource_id);

-- 受理时锁这一行，把同一项目的额度判定串行化（设计 §3、D31）。
CREATE TABLE resources.project_locks (
  project_id text PRIMARY KEY
);
