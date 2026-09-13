-- 创建时所选的初始套餐；仅在首次生成仓库时写入 Manifest。
-- 旧记录没有可信的选择事实，保留 NULL；不可拿当前平台默认值补成历史事实。
ALTER TABLE project.projects ADD COLUMN initial_plan text;
