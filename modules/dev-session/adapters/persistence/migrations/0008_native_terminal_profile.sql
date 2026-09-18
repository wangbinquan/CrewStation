-- RFC-006：CLI 受理记录固定档位修订；驱动、模型与运行环境版本由档位修订给出（断代，C8）。
ALTER TABLE dev_session.native_terminal_starts ADD COLUMN IF NOT EXISTS profile jsonb;
ALTER TABLE dev_session.native_terminal_starts DROP COLUMN IF EXISTS driver;
ALTER TABLE dev_session.native_terminal_starts DROP COLUMN IF EXISTS model;
ALTER TABLE dev_session.native_terminal_starts DROP COLUMN IF EXISTS runtime;
