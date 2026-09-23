-- 仓库的网页地址（GitLab 自报的 web_url），给浏览器打开用；克隆、构建、推送仍用 http_url。
-- 可空：这之前建的绑定在第一次被读到时由应用向 GitLab 补一次（2026-09-23 作者裁定），迁移不访问 GitLab。
ALTER TABLE scm.repository_bindings ADD COLUMN IF NOT EXISTS web_url text;
