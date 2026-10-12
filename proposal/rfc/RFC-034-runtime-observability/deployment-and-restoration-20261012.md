# RFC-034 2026-10-12 部署、数据库恢复与原 A/B 验收

本记录只关闭本片部署、原 A/B 清理和临时配额恢复。RFC-034 仍为 In Progress；默认开发采集 producer、CLI、平台算力自测、完整界面矩阵、规模和持久增量事实仍按 remaining-work.md 的原退出条件继续。

## 已提交源码与实际部署

修复源码 `6311b8943afab29e9046c98ba13f283a4072cae7` 的 [准确六项 CI 38189279209](https://github.com/wangbinquan/CrewStation/actions/runs/38189279209) 全部成功，2026-10-12 04:20 UTC 再查仍为 completed/success。对应候选的唯一完整本机检查为 6,600 pass、176 原条件 skip、0 fail，6,776 tests／1,344 files；旧检查失败保留，没有重跑同一候选追逐绿色。

2026-10-12T01:17:38.295Z 完成七后端正常部署。实际 OCI 为 `sha256:d14ce4101a3608a738ce947f338888df38d71577ace88b40ca4fbd5dbee04e95`，七个后端的实际 Pod imageID 与源码修订已逐一核对；console 保持 `67b6d44594c8239721c8a836bbd6d3203b155645`。正式迁移原 261 项保持，新增 0 项，原 dev_session/0019 保持已应用。不把 backend 和未改 console 写成同 SHA 八组件。

## 获准扩容与原数据库恢复

原 Docker 虚拟磁盘 200 GiB 已用满，原 PostgreSQL 因 ENOSPC 无法启动。用户明确批准增加到 232 GiB，并允许应用过程中 Docker 正常重启。图形设置入口超时后，使用官方 settings-store.json 的唯一 DiskSizeMiB 字段和 Docker Desktop CLI 正常 stop/start；设置从 204800 MiB 改为 237568 MiB，其他字段保持，没有 reset、缩容或删除资源。一次 stopped 状态输出断言失败发生在设置写入前，该失败留档。

扩容后节点文件系统可用 32,576,057,344 字节（约 30.34 GiB），Docker.raw 逻辑大小 249,108,103,168 字节。原 27 个 PV UID 全部保持，原 postgres-0 UID `e1c096f1-223a-4a78-a67c-d5b66345bcb0` 保持、Ready=true；原库实际只读查询成功。恢复后七后端和 console 均 Ready=1、generation=observedGeneration，原部署镜像保持。此后没有继续清理镜像、缓存、卷或仓库。

## 同一原 A/B 和配额

- A `01a11899-ca07-7000-ada8-94539c911c9c`：AgentStart ended／finalized／logicalEnding=true，原 ending 为 evidence-complete，环境 released。原已采集总 Token 63,921，非缓存输入 21,822、缓存读取 41,856、缓存写入 0、输出 243，人民币验收估值 ¥0.066516 保持。
- B `01a11899-d396-7000-9315-07742ab95009`：恢复后由已部署的正常原作业接续，04:00:46.733 UTC 环境转为 failed/native finished；AgentStart ended／finalized／logicalEnding=true，ending 为 prestart-closed。原 firstReason=error、dispatchedAt=null、endedAt=2026-10-07T23:06:44.787Z 保持；numeric closure、logical result、actualEndedAt 仍不存在，数字仍 unknown，没有补零或创建替代 B。
- B 原消费者 `01a11899-d9ef-7000-b72d-39d5a517c112` 准入关闭、无 start permit。资源中心真实 kubelet-terminated stop proof 对应原 Pod UID `5e560268-cd02-49af-ae55-b58d88198896`；精确原 namespace/podName 的 GET 确认已不存在。没有手动删除 Pod 或修改结束记录。
- 同一验收项目 `01a1159a-de63-7000-9690-14f4d9cfdebb` 已在 B 闭合后，通过原 dev-admin 的正常 OIDC 登录和公开 PUT /v1/projects/:id/quota 将临时 6 恢复为原 3，expectedMaxConcurrentTasks=6；返回 200。公开 GET 复读和原库只读核对均为 3，运行数为 0。没有直接 SQL 写配额。

## 正式页面复验与边界

原 dev-admin 会话经正常本机开发角色 OIDC 续期后，正式系统 30 天页面再次显示完整快照：51 项任务／开发执行，已记录 Token 202,573（67,361／133,888／0／1,324），已记录人民币 ¥0.153514，缺口仍标不完整。项目名称、四桶、带实际 Token 数字的柱形和 A/B 行均可见；A 仍是 63,921／¥0.066516，B 仍显示未知／未完整定价。项目 01a1159a 的系统汇总为 5 项执行、109,526（45,656／63,424／0／446）和 ¥0.126592，原部分／缺口保留。

这次只证明恢复后的上述实际页面数据与清理状态；没有将 30 天首次加载等待签为性能达标，也没有代签窄屏、英文、暗色、CLI、默认 producer、平台自测、真实托管 AW、规模或全部 RFC 退出项。新持久事实设计见 persistent-usage-facts-20261011.md，尚未实施。

完整本机证据在 `/private/tmp/observability-cs-prestart-first-reason-deployment-20261012-v378/` 和 `/private/tmp/observability-cs-postdeploy-disk-full-20261012-v380/`，包含原失败、正式 CI 全日志 EOF 消费、构建／迁移／部署回执、原 PV/Pod UID、只读 A/B 状态、真实停止证明、公开配额恢复和正式页面截图；凭据不写入仓库。
