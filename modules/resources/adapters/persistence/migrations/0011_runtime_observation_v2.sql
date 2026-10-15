-- RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §7）：开发 Agent 不再有
-- 独立的数值日志存储与准入回执；原「开发准入回执」列随之退役（生产从未开启采集，列内无有效数据）。
ALTER TABLE resources.workload_consumers DROP COLUMN IF EXISTS development_admission;
