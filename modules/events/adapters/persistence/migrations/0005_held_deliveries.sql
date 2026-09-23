-- RFC-021：维护暂存的投递按服务、按接收顺序补发。
CREATE INDEX IF NOT EXISTS deliveries_held_idx ON events.deliveries (service_id, created_at) WHERE state = 'held';
