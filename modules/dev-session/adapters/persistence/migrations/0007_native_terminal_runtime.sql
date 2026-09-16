-- RFC-004：每条 CLI 受理记录固定它使用的运行环境版本。
ALTER TABLE dev_session.native_terminal_starts ADD COLUMN runtime jsonb;
