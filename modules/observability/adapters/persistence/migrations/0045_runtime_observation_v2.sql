-- RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §3/§7）：断代。
-- 退役 v1 运行观测的全部表、视图、序列、函数与触发器（账本、投影、报告、估值、价格、平台用量、开发原生页、
-- 异常、维护、存储……）；v1 已采集的数据与价格不迁移（作者 2026-10-14 确认）。告警、资源身份别名与项目删除栅栏保留。
DROP VIEW IF EXISTS observability.runtime_report_task_views CASCADE;
DROP TABLE IF EXISTS observability.accepted_execution_prices, observability.cost_visibility, observability.cost_visibility_receipts, observability.deletion_drain_admissions, observability.deletion_entities, observability.development_model_evidence, observability.development_native_owners, observability.development_native_packets CASCADE;
DROP TABLE IF EXISTS observability.development_native_pages, observability.development_native_passes, observability.development_native_paths, observability.development_native_sessions, observability.development_native_steps, observability.development_native_work, observability.execution_price_correction_audit, observability.execution_price_correction_records CASCADE;
DROP TABLE IF EXISTS observability.execution_price_corrections, observability.execution_valuation_receipts, observability.execution_valuations, observability.native_baselines, observability.native_capture_history, observability.native_captures, observability.native_repairs, observability.native_steps CASCADE;
DROP TABLE IF EXISTS observability.platform_usage_admissions, observability.platform_usage_bindings, observability.platform_usage_captures, observability.platform_usage_cursors, observability.platform_usage_evidence, observability.platform_usage_fold_totals, observability.platform_usage_observed_executions, observability.platform_usage_pages CASCADE;
DROP TABLE IF EXISTS observability.platform_usage_projections, observability.platform_usage_proofs, observability.platform_usage_record_folds, observability.platform_usage_totals, observability.runtime_anomaly_history, observability.runtime_anomaly_state, observability.runtime_daily_aggregates, observability.runtime_lazy_reports CASCADE;
DROP TABLE IF EXISTS observability.runtime_maintenance, observability.runtime_maintenance_members, observability.runtime_maintenance_rows, observability.runtime_occurrence, observability.runtime_occurrence_hour_executions, observability.runtime_occurrence_hours, observability.runtime_occurrence_task_hours, observability.runtime_projection_head CASCADE;
DROP TABLE IF EXISTS observability.runtime_projection_scopes, observability.runtime_report_clock, observability.runtime_report_counts, observability.runtime_report_leases, observability.runtime_report_pages, observability.runtime_report_receipts, observability.runtime_report_revisions, observability.runtime_report_rows CASCADE;
DROP TABLE IF EXISTS observability.runtime_report_task_documents, observability.runtime_report_task_refs, observability.runtime_reports, observability.runtime_source_quality, observability.runtime_storage_guard, observability.runtime_storage_samples, observability.runtime_task_bootstrap, observability.runtime_task_cache CASCADE;
DROP TABLE IF EXISTS observability.runtime_task_cache_rows, observability.runtime_task_current_rows, observability.runtime_task_metadata, observability.runtime_task_metadata_work, observability.runtime_task_proof_work, observability.runtime_task_publications, observability.runtime_task_record_work, observability.runtime_task_row_history CASCADE;
DROP TABLE IF EXISTS observability.runtime_task_work, observability.token_price_heads, observability.token_prices, observability.usage_changes, observability.usage_events, observability.usage_evidence, observability.usage_heads, observability.usage_model_evidence CASCADE;
DROP TABLE IF EXISTS observability.usage_pages, observability.usage_projections, observability.usage_snapshots, observability.usage_sources CASCADE;
DROP SEQUENCE IF EXISTS observability.runtime_task_change_sequence, observability.runtime_anomaly_history_sequence_seq, observability.runtime_row_publication_sequence, observability.runtime_maintenance_confirmation_sequence CASCADE;
DROP FUNCTION IF EXISTS observability.actual_deletion_admission(project text) CASCADE;
DROP FUNCTION IF EXISTS observability.advance_runtime_report_clock() CASCADE;
DROP FUNCTION IF EXISTS observability.deletion_permission(project text, operation text, generation integer, phase text) CASCADE;
DROP FUNCTION IF EXISTS observability.dirty_runtime_metadata(target text, project text) CASCADE;
DROP FUNCTION IF EXISTS observability.dirty_runtime_proof(target text, project text, kind text, original_key text) CASCADE;
DROP FUNCTION IF EXISTS observability.dirty_runtime_self_record(target text, project text, meter text) CASCADE;
DROP FUNCTION IF EXISTS observability.dirty_runtime_task(key text) CASCADE;
DROP FUNCTION IF EXISTS observability.dirty_runtime_task_project(key text, project text) CASCADE;
DROP FUNCTION IF EXISTS observability.entity_keys(entities jsonb, requested text) CASCADE;
DROP FUNCTION IF EXISTS observability.guard_content() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_correction_audit() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_deletion_entity() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_deletion_fence() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_drain_admission() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_inserted_content() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_original_drain_content() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_runtime_occurrence() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_runtime_task_document() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_runtime_view_original() CASCADE;
DROP FUNCTION IF EXISTS observability.guard_stopped_snapshot() CASCADE;
DROP FUNCTION IF EXISTS observability.occurrence_hour(at timestamp with time zone) CASCADE;
DROP FUNCTION IF EXISTS observability.original_drain_admission(project text) CASCADE;
DROP FUNCTION IF EXISTS observability.original_runtime_task_change() CASCADE;
DROP FUNCTION IF EXISTS observability.published_runtime_fold(m jsonb) CASCADE;
DROP FUNCTION IF EXISTS observability.related_projects(entities jsonb) CASCADE;
DROP FUNCTION IF EXISTS observability.row_entities(kind text, content jsonb) CASCADE;
DROP FUNCTION IF EXISTS observability.row_projects(content jsonb) CASCADE;
DROP FUNCTION IF EXISTS observability.runtime_view_rows(task text, version text, through numeric, selected_role text) CASCADE;

-- 写入前的项目准入：项目删除封写后拒绝本项目的新观测写入（v1 的原始排空例外随之退役）。
CREATE OR REPLACE FUNCTION observability.admit_project(project text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE canonical text;
BEGIN
  canonical:=observability.canonical_project(project);
  -- 写入方从不在持有行锁时排队等封写。
  IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('observability.project:' || canonical,0)) THEN
    RAISE EXCEPTION 'Observation project admission is closing' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM observability.deletion_fences WHERE project_id=canonical) THEN
    RAISE EXCEPTION 'Observation project is permanently closed' USING ERRCODE='55000';
  END IF;
END $$;

-- 一次 Agent 执行一行，原地更新（§3.1）。档位测试等平台执行没有项目。
CREATE TABLE observability.agent_calls (
  id uuid PRIMARY KEY,
  project_id text,
  source text NOT NULL CHECK (source IN ('business','development','platform')),
  kind text NOT NULL CHECK (kind IN ('subtask','agent','cli','profile-test')),
  task_id text NOT NULL,
  task_label text NOT NULL,
  subtask_id text,
  attempt integer CHECK (attempt > 0),
  runtime_task_id text NOT NULL,
  agent_id text NOT NULL,
  agent_key text NOT NULL,
  agent_label text NOT NULL,
  profile_id text NOT NULL,
  profile_revision integer,
  profile_name text,
  protocol text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','canceled','interrupted')),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL,
  usage_state text NOT NULL DEFAULT 'pending' CHECK (usage_state IN ('pending','partial','complete','none')),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens bigint NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0 AND reasoning_tokens <= output_tokens),
  cost_nano bigint NOT NULL DEFAULT 0 CHECK (cost_nano >= 0),
  cost_state text NOT NULL DEFAULT 'none' CHECK (cost_state IN ('none','priced','partial','unpriced')),
  CHECK ((source = 'platform') = (project_id IS NULL)),
  CHECK ((status = 'running') = (ended_at IS NULL))
);
CREATE INDEX agent_calls_started ON observability.agent_calls (started_at, id);
CREATE INDEX agent_calls_project_started ON observability.agent_calls (project_id, started_at) WHERE project_id IS NOT NULL;
CREATE INDEX agent_calls_task_started ON observability.agent_calls (task_id, started_at);
CREATE UNIQUE INDEX agent_calls_running_agent ON observability.agent_calls (runtime_task_id, agent_id) WHERE status = 'running';

-- 按实际模型拆分的用量（§3.2），每次快照整组替换。
CREATE TABLE observability.agent_call_models (
  call_id uuid NOT NULL REFERENCES observability.agent_calls(id) ON DELETE CASCADE,
  model text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cache_read_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens bigint NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  reasoning_tokens bigint NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0 AND reasoning_tokens <= output_tokens),
  price_id uuid,
  cost_nano bigint CHECK (cost_nano >= 0),
  cost_state text NOT NULL CHECK (cost_state IN ('none','priced','partial','unpriced')),
  PRIMARY KEY (call_id, model)
);

-- 只追加的人民币价格线（§3.3）：微元 / 百万 Token，null 为未知（不是免费）。
CREATE TABLE observability.price_versions (
  id uuid PRIMARY KEY,
  profile_id text NOT NULL,
  model text NOT NULL CHECK (length(model) BETWEEN 1 AND 300),
  input_micro bigint CHECK (input_micro >= 0),
  cache_read_micro bigint CHECK (cache_read_micro >= 0),
  cache_write_micro bigint CHECK (cache_write_micro >= 0),
  output_micro bigint CHECK (output_micro >= 0),
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL,
  note text NOT NULL DEFAULT ''
);
CREATE INDEX price_versions_line ON observability.price_versions (profile_id, model, created_at);

-- 项目费用可见性（§3.4）：没有行即不可见。
CREATE TABLE observability.project_cost_visibility (
  project_id text PRIMARY KEY,
  visible boolean NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);
