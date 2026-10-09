# RFC-038｜现有能力核对

> 2026-10-09；开工基线 `bc97b28b`，fetch 后 main／origin/main 相同。以下来自当轮工作树源码读取；并行在制文件保留。

| 证据 | 当前行为与依据 | 设计结论 |
|---|---|---|
| E01 | `apps/console/src/features/release/pages/ReleasePage.tsx:58`：接受发布只留下 release 查询参数，准备弹窗卸载；下一行挂 SelectedRelease | 受理回执必须接续同一向导，而不是关闭后往页尾画详情 |
| E02 | `apps/console/src/features/release/components/PublishDialog.tsx:31`：三步分别来源、检查、版本，发布是最后一步 | 合并准备输入，扩展到验证与正式上线 |
| E03 | `apps/console/src/features/release/model/usePublishPreparation.ts:53`：发送 expectedCommitSha／expectedTaskId；56 行受理后 reset 草稿；57 行失败重回来源 | 保留固定来源与单次写锁，异常就地恢复上下文 |
| E04 | `apps/console/src/features/release/pages/ReleasePage.tsx:40`：owner／developer／admin 可发布，41 行只有 owner／admin 可切流 | 连续 UX 不扩大切流权限 |
| E05 | `modules/dev-session/application/publishFromSession.ts:22`：检查原 task、工作树 HEAD、未提交清单和分支，推送后交 release | 会话来源检查与代推语义复用，不自动代提交 |
| E06 | `modules/release/application/publish.ts:20`：活动交接／在途发布阻断；26 行 Manifest／资源／迁移预检；28 行打标签；36–37 行事务内再查在途 | 前端来源检查不冒充完整部署预检，全部后端守卫保持 |
| E07 | `modules/release/application/publishPrecheck.ts:29`：按固定提交校验 Manifest、迁移策略、部署资源；构建后继续核对 | 发起前承诺限于已读取事实，生产数据及迁移提示提前显示 |
| E08 | `packages/contracts/api/release.ts:10`：DTO 含当前状态、createdAt／updatedAt，没有阶段历史；`modules/release/domain/release.ts:28` 内部只有部分流水线时间与引用 | 历史向导需要新增持久事件，旧 DTO 无法凭空复原 |
| E09 | `modules/release/application/pipelineBuild.ts:41`：有迁移命令才启动迁移；66 行已有固定镜像可绕过构建；`pipelineDeploy.ts:97` 观察待命槽就绪后保存 ready | 必须区分无需构建／无需迁移与真正成功，不画虚假的完成阶段 |
| E10 | `apps/console/src/features/release/model/deployedVersions.ts:27`：读取实际两槽和精确 release，再核 service、SHA、tag 与 ready；`shared/project/deployedSlot.ts:10` 要求 ready、副本、host | 历史 ready 不能作为当前可验证／可切流目标 |
| E11 | `modules/release/application/switchTraffic.ts:24`：fenced 操作按 requestKey 幂等；40 行禁止策略不允许的回退；48 行启用交接；普通切流在69行直接记切流事件 | 新向导必须保留这些检查；新流程记录可为普通切流提供相同意图防重 |
| E12 | `modules/release/application/execution/handoff.ts:70`：activating 的71行等待实际路由，74行等待目标激活，76行原事务记 complete | 接受上线请求不是上线完成 |
| E13 | `modules/platform/application/executionHandoffPorts.ts:13`：observeRoute 核对 activeEndpoint 与 gateway.productionRouteObserved | 普通上线的生效观察也能通过现有端口，不越层读取 gateway 内部 |
| E14 | `apps/console/src/features/release/components/ReleaseTimeline.tsx:35`：已有发布、切流、槽生命周期和维护合并；56 行标签触发 releaseId 详情；`queries.ts:62` 发布列表仅50条 | 保留原事件，新增按操作的流程及游标分页，列表不要宣称已覆盖全部历史 |
| E15 | `apps/console/src/features/logs/hooks/useLogFeed.ts:35`：现有日志是有界 Pod 尾部，无历史游标；request 支持 releaseId；`LogTail.tsx:13` 只接受开发 taskId | 日志不可用不是流程失败；复用通用日志展示需移至 shared，禁止 release 跨 feature import |
| E16 | `apps/console/src/shared/ui/progress/StageProgress.tsx:27` 与 `stageProgressView.ts:8`：通用状态／时间／错误显示；时间为可选 | 复用既有阶段条，未知时间不给假值；若整体起点未知，仅绘制有证据阶段 |
| E17 | `apps/console/src/app/router/adminProjectRoutes.ts:28`、`routeTree.ts:48`、`shared/project/projectPaths.ts:1`：租户与接入管理两套路由共用发布页；开发入口 `DevSessionWorkbench.tsx:114` 带 source=session | 两端和所有入口一次迁移；旧链接精确转换 |
| E18 | `modules/release/adapters/persistence/projectContent.ts:11` 枚举全部 release 表／列，98 行完整 schema 核对；143 行发现未知表会阻断；`tables.ts:29` service＋tag唯一 | 新历史表与字段必须同批纳入原删除盘点和回收；明确 tag 可只读定位丢失回执 |
| E19 | `apps/console/src/tests/publishWizard.test.tsx:50` 离线零写、64行已发送回执丢失不重发、106行202不冒充部署成功、169行未知ID不退回最新；`releaseDelivery.test.tsx:178` 同意图 requestKey 不变 | UI重构保留语义断言；额外验证刷新后同意图仍不重发 |

这是源码行为核对，不是当轮集群或生产流程验收。原型只用于核对方案交互，不能替代实现后的真实浏览器、精确提交 CI 与部署证据。
