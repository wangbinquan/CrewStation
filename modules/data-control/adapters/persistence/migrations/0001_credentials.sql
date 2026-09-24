-- RFC-025 I28：data-control 建库与角色时生成的口令（平台密钥加密），按记录 ID 存；台账与期望里不放凭据。
CREATE SCHEMA IF NOT EXISTS data_control;

CREATE TABLE IF NOT EXISTS data_control.credentials (
  resource_id text PRIMARY KEY,
  role text NOT NULL,
  secret_box text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
