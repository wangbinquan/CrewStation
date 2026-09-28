-- Task-owned volume consumers outlive their individual Pods and resource compaction.
CREATE TABLE resources.task_volume_safety (
  resource_id text PRIMARY KEY,
  body jsonb NOT NULL
);
CREATE TABLE resources.task_storage_fences (
  task_id text PRIMARY KEY,
  finalization jsonb,
  sealed boolean NOT NULL DEFAULT false
);
CREATE TABLE resources.workload_consumers (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  resource_id text NOT NULL,
  namespace text NOT NULL,
  pod_name text NOT NULL,
  consumer jsonb NOT NULL,
  admission_closed boolean NOT NULL DEFAULT false,
  start_permit jsonb,
  UNIQUE(namespace, pod_name)
);
CREATE INDEX workload_consumers_task ON resources.workload_consumers(task_id, id);
CREATE TABLE resources.workload_stop_proofs (
  consumer_id text PRIMARY KEY REFERENCES resources.workload_consumers(id),
  record jsonb NOT NULL
);
CREATE TABLE resources.workload_admission_closures (
  id text PRIMARY KEY,
  identity jsonb NOT NULL
);
CREATE TABLE resources.workload_stop_scans (
  task_id text NOT NULL,
  revision integer NOT NULL,
  scope text NOT NULL CHECK (scope IN ('business','all')),
  body jsonb NOT NULL,
  PRIMARY KEY(task_id, revision, scope)
);
