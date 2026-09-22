# RFC-018｜实施与验证

状态：Done · 2026-09-22 · T1–T9 与 EG-01…EG-08 全部完成。作者已批准 proposal §5 的八项能力影响清单，并裁定 Q1＝C（只给接入容器项目放开服务槽出向）、Q2＝b（本次即清理 `egress` schema 与四行迁移记录，先做停写备份）。

## 任务

| 任务 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| RFC-018-T1 | ADR-0008 模块退役：删目录、手工退出锁条目、schema 清理、依赖边删除 | — | ADR 状态 已接受 |
| RFC-018-T2 | 网络策略（方案 C）：k8s 对象、`ensureNamespace` 按项目 kind 分支、启动重下发工作器、保留资源清单 | — | EG-03 |
| RFC-018-T3 | 删除 `modules/egress`、组合根装配、两处依赖声明、四条锁条目 | T2 | EG-02、EG-06 |
| RFC-018-T4 | 契约与 api-client 删除，`AlertTypeSchema` 收缩 | T3 | EG-02 |
| RFC-018-T5 | 工作台：页面、页签、待办、导航、搜索、i18n、重定向与归一，用例与夹具 | T4 | EG-01 |
| RFC-018-T6 | 安装器：配置字段、预检、初始化与用例 | T4 | EG-05 |
| RFC-018-T7 | 参考代理直连上游；本机按标签发布新版 | T2 | EG-04 |
| RFC-018-T8 | 文档回填：基线 v0.3.7、tech-evaluation、仓库结构 v0.5、I9、dev-gotchas、集成与模板文档、e2e 清单、RFC-003 附件标注 | T1–T7 | EG-07 |
| RFC-018-T9 | 门禁、本机部署、历史数据清理、实机验收、精确 SHA CI、STATE | T1–T8 | EG-06、EG-08 |

## 本机部署顺序

1. `bun run check` 通过后构建控制面与工作台镜像并滚动更新。本次没有新增迁移文件，只有第 4 步的手工 SQL。
2. 控制面启动后逐项目命名空间核对 NetworkPolicy 集合：接入容器项目多一条 `crewstation-integration-egress`，数字人项目不变。
3. 发布参考代理新版本（平台标签发布），从开发容器经网关发一次真实 `GET`，期望 200；代理日志无 `/internal/egress/http`。
4. 历史数据清理，顺序不可调换：停写备份并校验 → `DROP SCHEMA egress CASCADE` → `DELETE FROM platform_infra.migrations WHERE module = 'egress'` → 核对 `egress-blocked` 告警行 → `\dn` 与迁移表复查 → 平台重启确认就绪。记录备份路径、各步行数。
5. e2e 层复跑；STATE 接力段写明镜像标签、命名空间核对结果、代理版本与清理证据。

## 共享工作树注意

- 只按显式路径暂存与提交；删除目录用 `git rm -r modules/egress`。
- 锁文件的四条删除是手工编辑，提交说明注明「按 testing.md §7 退出已删除模块的迁移」；不要运行不带路径的 `bun run migrations:lock`。
- 对 RFC-003 的标注只改 `proxy-egress.md`，不碰其 `design.md`。

## 验收清单

| 编号 | 状态 | 证据 |
|---|---|---|
| EG-01 | 通过 | 管理左栏「资源与网络」只剩算力档位；`/admin/egress` 重定向到 `/admin`；`/admin/requests?tab=egress` 正常显示 API 申请列表，草稿保护仍生效。用例见 `adminRequestPages.test.tsx`、`adminCapabilities.test.tsx`、`adminNavigation.test.tsx`、`spaceSeparation.test.ts` |
| EG-02 | 通过 | 部署后在 cs-api Pod 内实测六条路由全部 404（`/v1/egress/entries`、`/v1/egress/requests`、`/v1/egress/requests/page`、`/v1/projects/:id/egress/blocked`、`/internal/egress/http`、`/internal/egress/blocked`），同轮 `/v1/api-requests` 仍为 401（未带身份），证明不是整体掉线 |
| EG-03 | 通过 | 本机 11 个项目命名空间逐个核对：3 个接入容器项目（`cs-gitlab-event-producer`、`cs-reference-api-proxy`、`cs-rfc003-verify-integration`）各有 4 条策略含 `crewstation-integration-egress`，8 个数字人项目各 3 条且没有它。cs-controller 日志 `namespace reapply done total=11 applied=11 failed=0`。另有 `namespaceProvisioning.test.ts` 以真实数据库＋fake k8s 覆盖同一判断，含两次变异验证 |
| EG-04 | 通过 | 作者裁定 I23 取方案 a 后，两个接入项目的 manifest 迁到 v2，各发 `v0.1.4` 并切流到生产槽。随后从**已登记的数字人** `cs-demo` 的服务槽 Pod 经网关调默认开放操作 `GET /api/test-gitlab/v4/projects/29/repository/commits/{sha}`，得 **HTTP 200 与真实 GitLab 数据**（返回的正是迁移提交 `1d88a7d2` 本身）。代理日志记 `forwarded … status 200`，最近 500 行里 `/internal/egress/http` 出现 0 次。同轮对照：同一调用方请求未开放的操作得 403，说明网关放行判定照常生效 |
| EG-05 | 通过 | `installConfig.test.ts`：含 `egress` 段的旧配置照常解析，`egressAllowlist` 字段已不存在，原值留在 `raw.egress`；`installInitialize.test.ts`：初始化不再出现出站检查行，也不再发出站请求 |
| EG-06 | 通过 | 完整 `bun run check`（带本机测试库与 e2e 参数）**2069 pass／8 skip／0 fail**，13034 断言、347 文件；改动行防护 **100／100（100%）**；`arch:check` 53 个单元零违规，`migrationCoverage` 与锁文件一致 |
| EG-07 | 通过 | 基线三件套 v0.3.7、tech-evaluation E23 作废、仓库结构 v0.5＋ADR-0008、I9 关闭、`dev-gotchas` 网络策略条目改写、三份 CONTRIBUTING 与参考代理 README、e2e 页面清单、CLAUDE.md 全部更新 |
| EG-08 | 通过 | 先升级平台代码，再取整库一致性备份（Pod 内 `pg_restore -l` 校验 469 个对象、含 egress 四张表与数据，本机副本 `cs-rfc018-verified.dump` 31,304,900 字节），随后一个事务内 `DROP SCHEMA egress CASCADE`（4 张表：entries／requests／blocked／resource_identity_aliases，共 5 行）＋删除 4 行迁移记录。复查：`egress` schema 0 个、该模块迁移记录 0 行、`egress-blocked` 告警 0 行、总 schema 20、总迁移 103。重启 cs-api／cs-controller 后迁移数仍 103、schema 未被重建 |

**EG-04 的闭合路径**：阻塞它的 I23 已按作者裁定的方案 a 解决（manifest 迁 v2，提交 `1d88a7d2`、`f24e880f`），
两个项目各发 `v0.1.4` 并 `ready`；作者授权后切流成功（`POST …/traffic-switch`，两个服务均 HTTP 200，
路由与 `release.service_slots.active` 都翻到 blue）。**`toSlot` 传的是角色不是物理槽**：待命槽当前角色即 `preview`，
切完变 `prod`；传 `prod` 会被 `physicalOf` 解析回当前线上槽并以「已经是当前线上槽」拒绝。

**一处本机基础设施问题，与本 RFC 无关但决定了验证方式**：这台 kind 节点上 Pod 访问 Service ClusterIP 不通，
直连 Pod IP 正常——同一 Pod 内对照，Traefik 的 `10.96.199.52:80` 连不上，其 Pod IP `:8000` 返回 200。
它同样解释了此前 cs-api 连 Prometheus 失败、以及 e2e `clusterMetrics` 历史新鲜度时红时绿。
因此上面的真实调用用 Traefik 的 Pod IP 加 `Host: api.svc.cs.internal` 发起：绕过的只是 kube-proxy 的 VIP 转换，
网关路由、源 Pod IP 身份解析、放行表判定、代理到上游这几段都照常经过。


**两处既有 flake**（都在本次未改动的文件里，单跑均通过，与本 RFC 无关）：
`releaseDelivery.test.tsx` 的「并列真实部署与完整 SHA」、`agentExecutionStreams.test.tsx` 的「执行环境准备中写明排队或调度原因」，
以及 e2e 的 `clusterMetrics` 历史新鲜度（RFC-015 范围，在本次部署之前的旧镜像上同样红过）。
