-- 切流记录补上「切之前的线上发布」：回滚要知道从哪个版本切走的，只有新发布 id 不够。
ALTER TABLE release.traffic_switches ADD COLUMN IF NOT EXISTS previous_release_id text;
