-- RFC-025 I31：先提交轮换意图，再改数据面；崩溃重试沿用同一密文，直到确认完成。
ALTER TABLE data_control.credentials ADD COLUMN pending_box text;
