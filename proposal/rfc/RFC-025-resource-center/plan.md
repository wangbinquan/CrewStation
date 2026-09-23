# RFC-025｜实施计划

> 状态：In Progress · 2026-09-23 · 作者「批准并实施」（Q1–Q8 按草案写法，C1–C8 确认）
> 配套：[提案](./proposal.md) · [技术设计](./design.md) · [现状盘点](./audit.md)

## 目录

- [1. 任务与依赖](#1-任务与依赖)
- [2. 验收清单](#2-验收清单)
- [3. 交付门禁](#3-交付门禁)

## 1. 任务与依赖

分六期（设计 §11.1）；每期独立提交、部署本机、实机验收后再进下一期。

| 任务 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| RFC-025-T1 | 作者四轮裁定 D1–D13；只读盘点落档（`audit.md`）；三件套与 ADR-0009 草案落档并登记；作者「批准并实施」 | 作者 | 已完成（2026-09-23，Draft 4a60a287） |
| RFC-025-T2 | 实测：Traefik `rateLimit`／`inFlightReq` 超额时的状态码与 `Retry-After`、计数范围（每路由还是共享）、多副本网关的分布式后端；SSE 经 Traefik 的缓冲、心跳与空闲超时；按标签 watch 在本机的稳定性；结论写进 `design.md` §7.3、§8 | T1 | 未开始 |
| RFC-025-T3 | 契约与 api-client：`api/resources/*`（记录、阶段、条件、子对象、可做操作、视图、流事件）；旧词汇映射（设计 §4.3）的纯函数与逐行用例；429 解析为 `rate_limited`；`contracts:lock` 只增不删 | T1 | 未开始 |
| RFC-025-T4 | `modules/resources`（L1）：schema 与迁移（登记迁移锁）、种类注册表与阶段规则、受理与平台预检、按台账推导额度、保留期、可做操作、视图 HTTP、SSE 与尾随器；`tools/arch/policy.ts` 登记；ADR-0009 转为已接受 | T3 | 未开始 |
| RFC-025-T5 | `packages/resource-runtime` 与 `modules/cluster-control`（L2）骨架：观测缓存、工作队列、租约、退避；收编作业（第一期只报告不改动） | T4 | 未开始 |
| RFC-025-T6 | 一期·任务类容器：`dev-workspace`、`agent-execution`、`business-workspace`、`volume`、Runner Secret、开发预览路由的期望与调和；`stopping` 受理即生效；失败的开发会话保留 72 小时；按种类回收与孤儿回收；`task-runtime`／`dev-session`／`business-task` 改为写期望、上报条件；旧接口由记录推导；额度计数器退役 | T5 | 未开始 |
| RFC-025-T7 | 一期·工作台：`useProjectResources`（快照＋SSE＋续传）；开发页 CLI 标签、拓扑、概览开发卡改读记录；「结束中」；页面不自行推导状态的守卫用例 | T3、T6 | 未开始 |
| RFC-025-T8 | 二期·服务槽与构建：`service-slot`、`build-job`、`migration-job` 的期望与调和；统一预检接入发布、重新部署与切流；`observability` 健康、发布页槽卡改读记录 | T5 | 未开始 |
| RFC-025-T9 | 三期·路由与说明页：槽路由、服务域与 `/api/<proxy>` 路由、开发预览路由统一为 `route`；同 Host 唯一；说明页（HTML 与 503＋JSON）；身份索引改读观测、墓碑清理；去掉 Traefik 的 `allowEmptyServices` | T8 | 未开始 |
| RFC-025-T10 | 三期·限流：平台设置与项目覆盖（`gateway` 校验并写 `rate-limit-policy`）；中间件渲染；工作台与命令行的 429 处理；能力说明 MCP 文案 | T2、T9 | 未开始 |
| RFC-025-T11 | 四期·命名空间、额度、网络策略：`provisioning` 改写期望；被改动或删除时补回 | T5 | 未开始 |
| RFC-025-T12 | 四期·数据资源：`data` 写 `database`／`data-binding` 期望；`modules/data-control`（L2）迁入数据面执行代码 | T5 | 未开始 |
| RFC-025-T13 | 五期·集群管理与摘要：清单与拓扑读全平台视图；运维操作经台账；「待回收的工作卷」与确认词删除；`capabilities` 摘要改读视图 | T6、T8、T9 | 未开始 |
| RFC-025-T14 | 六期·收编正式运行：处理本机全部遗留对象（audit §1 实查清单），旧标签改写、别名入账；逐项核对 | T6–T13 | 未开始 |
| RFC-025-T15 | 限流默认值校准：本机突发脚本打三类流量，报告实测结果，作者定 Q4 | T10 | 未开始 |
| RFC-025-T16 | 每期：本地 gate、改动行防护、提交推送、精确 SHA CI；本机部署与实机验收（含两个 cs-controller 副本的租约与接手）；写 `acceptance.md` | 各期 | 未开始 |
| RFC-025-T17 | 回填：基线 Proposal（新需求号）、Design（新节、决策号，D53 修订）、Plan（验收编号与矩阵行）；RFC-003／006／010／015／019／020／021／022／024 与 ADR-0006 加修订说明；`repository-structure.md` 模块表；README、STATE.md、dev-gotchas | T16 | 未开始 |

## 2. 验收清单

对应提案 §13。实机时每项记录身份、页面、视图接口与推送事件、`kubectl` 与库里的核对结果，写进 `acceptance.md`。

| 编号 | 证据 |
|---|---|
| RC-01 | 同一资源在六处页面的阶段与原因截图，与 `GET …/resources` 的记录逐字段对照 |
| RC-02 | 结束 CLI 时两个窗口的推送事件（`upsert` 的阶段 `stopping` → `stopped`）与时间；离开再回来、刷新、另一名成员的截图；网关日志只有一次结束请求 |
| RC-03 | 断网恢复后的续传事件序列；过旧游标得到 `snapshot`；移出成员后该成员的流被断开的服务端日志 |
| RC-04 | 缩短保留期后，失败会话的记录（`retainUntil`）、期间的日志与重试、到期后 Pod／路由消失与工作卷的 `PendingReclaim` |
| RC-05 | 人为制造的孤儿对象清单与调和器的删除审计；孤儿 PVC 的记录与管理员删除过程 |
| RC-06 | audit §1 实查清单逐项的处理结果 |
| RC-07 | 四种预检失败的接口返回（原因码、说明、出路）与台账里没有新记录 |
| RC-08 | 说明页截图与 503＋JSON 返回；重新部署后恢复；同 Host 路由只剩一条的 `kubectl` 结果 |
| RC-09 | 三类突发脚本的结果（429、`Retry-After`）；工作台自动重读的提示；推送流与终端连接在并发上限下不断开 |
| RC-10 | 改平台默认值与项目覆盖后，网关中间件的变化与生效时间 |
| RC-11 | 额度在并发抢占下的拒绝记录；删掉资源后额度回来 |
| RC-12 | 五类基础资源的记录；删掉一条网络策略后被补回的时间与审计 |
| RC-13 | 两个 cs-controller 副本的租约表与日志；杀掉持有者后另一副本接手 |
| RC-14 | 集群管理与各页对照；`tools/arch` 新规则的用例 |
| RC-15 | 旧 `rel_…`／`tsk_…` 的别名查询与记录只用 UUID |
| RC-16 | 本地 gate 输出、改动行防护结果、精确 SHA 的 CI 链接 |

## 3. 交付门禁

- 每期提交前在「HEAD＋本期」干净导出树上跑 `bun run check:static` 与 unit／module／console 三层；新用例先在旧代码上确认为红。
- 每期都要：改动行防护（新增代码防护 80%）、精确 SHA 的 CI 六项成功、本机实机验收写进 `acceptance.md`。
- 触及共用文件（i18n、用例、STATE.md、RFC 文档）时用私有索引只提交自己的 hunk；部署前通知并行会话。
- 任何一期发现设计缺口，记进 `docs/engineering/implementation-open-questions.md`，等作者裁定，不自行决定。
