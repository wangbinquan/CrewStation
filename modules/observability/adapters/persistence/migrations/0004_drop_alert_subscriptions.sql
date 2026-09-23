-- 基线 v0.3.13（Design D61）：删除项目级告警订阅，首版不做告警通知；告警只在工作台告警页查看。
DROP TABLE IF EXISTS observability.alert_subscriptions;
