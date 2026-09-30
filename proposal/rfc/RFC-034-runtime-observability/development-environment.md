# RFC-034 实际开发执行数字布局查询

状态：限定设计与9路径实现独立功能门PASS，相关24pass/0fail/0skip、231断言、6文件，精确9TS lint与后端类型通过；稳定候选单次完整4568pass/143skip/0fail，9路径指纹未变。13路径已精确推送808c5af0、该精确提交六项CI成功，并于2026-09-30T16:05:16.903Z部署八组件；详细回执见末节。承接Session实际执行登记查询；只补task-runtime自己的持久环境快照，不提供未绑定零、物理退出、资源删除或生产启用许可。

## 已有断点与本批范围

既有getEnvironment/EnvironmentDto与dev-session的EnvironmentView没有暴露render.developmentUsageStorage。owner持久意图、父工作区PVC、Runner info/stop not_found都不能证明实际子执行采用了新的数字日志布局。task-runtime在首次createNativeExecution时持久固定render选项、原父任务/Agent/算力、原namespace/Pod和start；同ID重放对developmentUsageStorage做sameRequest核对。源码为modules/task-runtime/domain/taskEnvironment.ts、application/nativeExecution.ts、api/moduleApi.ts、wiring.ts。

本批只增加进程内TaskRuntimeModuleApi.lookupDevelopmentUsageLayout(taskId)，从本模块真实持久环境主键只读，使用独立严格合同。既有公共EnvironmentDto/HTTP JSON及普通getEnvironment不新增字段；不修改dev-session Environments、dispatch/ending、native受理/清理、任何资源台账或项目删除装配。没有新表/迁移、跨模块私表联查、Runner/Kubernetes调用或新定时器。

## 严格查询合同与来源

DevelopmentUsageLayoutLookupSchema为严格version=1的三分支，使用实际executionTaskId作为查询主键：

- absent：SQL成功无持久环境；仅version/executionTaskId/kind三个字段。这不证明从未创建、已退出或Token零。
- legacy：持久环境存在且其render.developmentUsageStorage确实省略；也仅三个字段，不把其他用途或旧layout升级为数字支持，不构成普通启动回退的授权。
- selected：实际持久render选择了严格DevelopmentUsageStorage version=1。返回原projectId、workspaceTaskId=native.parentTaskId、agentId、native.computeProfile的profileId/profileRevision、namespace、podName、nullable podUid、environment state、native state、renderStart、持久revision=updatedAt ISO，额外layout={version:1}。不带token/零水位/closure、nonce、prompt、beforeStart、凭据、Runner令牌哈希或完整render。

selected必须来自kind=dev-session的独立native.purpose=agent执行，不能带terminalId；原computeProfile必须存在、ID与修订严格合法。任务执行ID、项目、父任务、Agent、算力均按现有UUIDv7合同解析。namespace/Pod名与原Pod UID只来自当前这一持久行；同时存在env.podUid与native.podUid而不一致时抛错，不能任选其一。有一个合法UID时返回它，两者均未受理实例时明确null；null不能当作物理停止。renderStart为安全正整数，不由owner执行世代或当前时间推断。持久updatedAt作为快照版本，不表示模型执行时间。

render.developmentUsageStorage有值但版本/形状不支持、没有必要native/原算力元数据、错用途/错ID、Pod UID不一致等必须保持错误，不能降级legacy/absent。SQL和传输故障同样不降级。响应实际executionTaskId必须等于请求；无行才absent。纯投影先严格解析选项和完整selected；应用先TaskIdSchema验证输入，执行真实read.environments.getById，再检查返回行id确属请求。接口通过现有composition root装配，公开getEnvironment转换保持原样。

## 并发语义与后续边界

本查询是单行只读快照，不持有dev-session owner、项目或资源的锁，也不关闭任何准入。返回selected仅证明该数据库快照有实际新layout，不证明Pod存在、退出、采集完整或没有迟到dispatch。未来未绑定结束与删除许可必须另外联合owner关闭、首次派发前证明、Session显式absent和实际Pod证据，并在最终拥有者事务中对拍这一行的ID、原算力/实例、layout/start/revision和子集。查询失败或对拍变化必须等待，不重配价格/凭据或从另一个环境猜值。本批不实现这些许可。

## 验证与退出条件

纯合同与领域投影覆盖无行、legacy、selected、非法版本/未知字段/错用途/缺原算力/非法ID/UID冲突、安全上界和无敏感材料；禁止仅靠DTO模拟SQL链。真实隔离PG覆盖创建新的显式headless数字执行后通过模块API读取原layout与归属、普通CLI/旧headless/父环境保持legacy、读后主行与台账/队列无变化、重建module读取一致、查询另一执行隔离、Runner离线/实例未建时podUid=null、实际SQL故障不降级。既有native同ID选项冲突和公共EnvironmentDto无新增字段继续断言。

先限定设计门，再实现与相关回归/精确lint/类型、独立功能实现门，稳定候选单次完整本机门禁。精确提交只包含自有路径，完整共享迁移锁只有在全部引用与相应模块齐备后才能发布（当前已随cc56齐备，详见回执）；未完成远端CI/部署不写为已完成。没有真实身份切换、模型调用或集群资源操作；生产开发采集OFF、sourceScope=business-tasks、CS-R02及两个RFC保持In Progress。

## 2026-09-30 限定实现与稳定候选门禁

实现为TaskRuntimeModuleApi.lookupDevelopmentUsageLayout→application/development/layoutLookup→read.environments.getById→domain/developmentUsageLayoutSnapshot→严格DevelopmentUsageLayoutLookupSchema三分支。组合根直接装配，只读取自己持久行；公开EnvironmentDto、旧CLI/headless受理/清理和业务合同保持原样。没有新表/迁移、当前算力/凭据查询、时钟调用、Runner/Kubernetes调用、排空或删除许可。

设计v1独立功能门PASS；实现v1限定独立静态功能门PASS，9/9路径首尾SHA256一致，无P1/P2阻断。真实隔离PG、模块重建和旧执行/布局回归最终24pass/0fail/0skip、231断言、6文件，精确9TS ESLint及后端类型通过。首轮相关已24pass/0fail；首次typecheck只有自有PG测试getEnvironment可选返回值1处错误，改为存在性断言与显式收窄后通过，没有放宽同ID重放一致性或失败断言。

本批唯一一次完整check于2026-09-30T15:26:34.010689Z结束：结构、全仓lint、两端types均通过；4568pass/143环境skip/0fail、29430断言、914文件，测试718.57s、整门767.42s。启动base05d4ca01d8414bd38f3958a225379b048d12bba3，期间并行main推进至cc56ee8818bdb87d76932a5fe3affd947d7e39ef；9个任务候选文件没有变化，没有取消或重跑。143skip不算实际身份/模型/集群验收。

并行共享提交cc56ee88已齐备并推送，当前main与origin/main核对0/0；完整193项迁移锁及引用已进入提交，无悬空引用。已有消费者965b45e8、派发646da1e9、持久结束94378917、Session查询05d4ca01均为该远端提交祖先，[精确CI36735324944](https://github.com/wangbinquan/CrewStation/actions/runs/36735324944)六项全部success。此远端CI证明cc56内容，不代作本批尚未发布的布局查询精确CI。此前Session查询全量的1项目录调用计数失败历史保留；并行持久层修复后的定向catalogSummary/transactionContext共4pass/0fail、28断言已确认。

实际生产开发采集仍OFF，sourceScope=business-tasks。两项只读独立查询完成不能当成unbound零、停止、实际Agent时间或删除许可；owner首次派发前/关闭准入、迟到普通命令旁路和实际Pod证明及最终事务对拍仍须补齐。生产lifecycle/定时器、全部回收/重建/保留期/项目删除屏障、consumer注入与两级开发事实/UI继续，CS-R02与两个RFC保持In Progress。实际部署回执单独记录。

## 2026-10-01 实际布局查询精确发布与本机部署

本批13个自有路径已精确提交并推送为 `808c5af0bf80445c8cfbaf1baca112b74c723b7f`，提交内容/路径/Co-Authored-By 已核对；推送后 main/origin/main=0/0、共享索引为空。前继消费者965b45e8、派发646da1e9、持久结束94378917与Session查询05d4ca01均随本版源码进入实际镜像；这只发布内部底座，不代表调用者已接通。

[本批精确CI36739319297](https://github.com/wangbinquan/CrewStation/actions/runs/36739319297) 的static/unit/module/console/e2e/gate六项全部completed/success，headSha严格等于808c5af0。前继cc56六项CI未代作本批验证。该CI和已记录的唯一稳定本机4568pass/143skip/0fail分别保留；没有因主干变化重复完整门禁。

本机于2026-09-30T16:05:16.903Z（北京时间2026-10-01 00:05:16.903）完成部署。先备份平台PostgreSQL，再核storage-contract=1与不可变镜像，迁移Job rfc034-development-environment-migrate-808c5af0 Complete、applied=0；八组件逐个滚动并核实际就绪。原平台库dump为42,606,924 bytes、SHA256 `20ce177dcc85ef63548cadf4dd8540cef69863ac30aa482fb32ac4ffc3162b38`，保存在本机私有临时证据目录，未上库。

镜像源码revision均核为808c5af0，实际部署manifest摘要分别是：
- console：`sha256:ed154c6b2265c8e22334e0c720ddeea1b717a5a3acb80c3d58274e5777b69758`
- control-plane：`sha256:5fed671017dda324c17588c18f3fd88eea2929baa0022a6cb38aa25267f48b01`
- task-runtime：`sha256:d1783c26996e8b21b2967739499bb134f0bb68bb6dd36a26d82f21fc039fa9b3`

默认Runner已核为同一task-runtime不可变摘要。八组件generation/observedGeneration分别为console207、cs-api201、cs-auth99、cs-controller166、cs-events69、cs-session118、mcp-capabilities65、mcp-operations65，Ready均1。2026-09-30T16:22:27.596165Z再次只读复核镜像/默认Runner/就绪一致，实际 `http://console.cs.localhost/auth/login` HTTP200、未登录根HTTP401。首次匿名探测误将CS_USER_DOMAIN裸域cs.localhost当工作台入口而得到404，随后根据实际IngressRoute修正Host；失败历史留在本机回执，没有将404写成部署成功。

生产开发采集仍OFF，sourceScope=business-tasks；没有切换真实身份、调用模型、创建/结束真实开发验证资源或替换旧会话。两项独立只读查询、内部消费者/派发/结束底座不能提供未绑定零、实际退出或清理许可。后续[普通启动屏障](./development-admission-fence.md)、owner关闭/首次派发前与原Pod证明、所有回收/重建/保留期/项目删除屏障、production消费和两级开发事实/UI继续；CS-R02及两个RFC保持In Progress。

## 2026-10-01 普通启动屏障外部失败的比例闭环

迁移锁的事件等待于登记后结束；2026-09-30T17:12:59.426126Z，只重查原 platform migrationCoverage 用例得到1pass/0fail、2断言，锁/装配/SQL/持久层5依据及9个自有源码指纹均未变。原唯一完整check4585pass/143skip/1fail和首次定向0pass/1fail的回执保留，不改写成全量0fail。随后共享持久层依赖变化的相关回归仍35pass/0fail、184断言、5文件，后台types-v3通过。

依据开发规则§3对他人在制品导致本地全量红的明确处理，以及用户共享候选“同内容完整门禁最多一次、无关变化只按比例核验”的要求，外部迁移失败已完成有证据的定向闭环；本批限定设计/实现审阅、精确lint/类型及相关用例有效。按17条精确路径进入发布，候选自身hosted CI另记；不收编并行迁移锁或资源删除文件，不重复完整门禁。此刻尚未提交/推送/取得自身CI或部署；实际本机仍808c5af0，生产OFF，sourceScope=business-tasks，CS-R02和两个RFC继续In Progress。
