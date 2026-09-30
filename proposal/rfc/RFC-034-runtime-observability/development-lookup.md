# RFC-034 Session 按实际执行查询原数字登记

状态：限定设计与11路径实现独立功能门PASS，27项相关回归、161断言、7文件、0fail/0skip，精确11TS lint与后端typecheck通过；单次完整本机门禁已结束：4560pass/143skip/1项外部失败，11路径指纹未变；详见末节。仅本地在制，未提交/推送/部署。承接持久结束内部候选943789175c1bcfbc216ee49e319ccef9c1e3a9bc（仅本地，未推送/部署）；新查询本身不提供Token零、物理停止或删除许可，生产开发采集仍OFF。

## 已有断点与本批范围

Session的developmentUsageStore.get(taskId,key)和/internal/tasks/:taskId/development-usage/read都需要原key；owner未绑定时没有key。空info、stop not_found、pending或finalThrough=0均不能证明独立Session没有登记。现有dev-session结束participant对unbound保持等待。源码：modules/session/ports/developmentUsage.ts、adapters/persistence/developmentUsage.ts、http/developmentUsageRoutes.ts、api/moduleApi.ts、wiring.ts；packages/session-client/developmentUsageClient.ts；dev-session/application/development/ending.ts。

本批只新增只读登记查询，打通真实Session PG→现有internal HTTP→严格session-client；不修改结束作业或消费者，不自动注册、生成key、查询Runner、推进ACK/排空或触发删除。后续unbound许可还必须独立证明新数字layout、原受理首次派发前、关闭绑定/派发准入和实际Pod归属，不能仅消费这次absent结果。

## 合同与数据来源

增加严格DevelopmentUsageLookupSchema，version=1、runtimeTaskId与kind：absent仅允许这三字段；registered额外包含完整StoredDevelopmentUsage，stored.registration.runtimeTaskId必须与runtimeTaskId相同。absent不含complete、零水位、closure、价格或估计量；不带prompt、nonce、凭据、原生内容或逐轮token记录。此为内部控制合同，既有业务/工作台JSON和key-required GET/POST语义保持。

store.lookup(TaskId)先用TaskIdSchema验证实际ID，再只读本模块development_usage_streams主键。查到行则返回原snapshot并验证严格合同；实际SQL查询成功无行才返回显式absent。不联查owner/task-runtime/项目私表，不读取在线Runner或进程缓存；PG错误、未启用或不完整升级都抛错，绝不降级为absent。查询不持有owner/项目/资源锁，关闭准入与对拍在调用方事务外另做。

SessionModuleApi新增lookupDevelopmentUsage，由composition接到持久store.lookup；现有内部控制面新增GET /internal/tasks/:taskId/development-usage/registration。沿用现有internalRoutes系统命名空间隔离，不宣称新增身份鉴权或公开浏览器接口。成功有登记/无登记均HTTP200且显式kind；非法taskId为400、存储未启用为既有precondition错误、PG或传输失败保持错误。既有/read查不到仍404，key错配仍conflict。

session-client新增同名lookup方法：调用上述GET、严格解析version/kind/Stored，并再次核response.runtimeTaskId等于请求。404、503、异常、非JSON、错ID、伪造absent零字段、错配登记都拒绝，不能catch后返回absent。未绑定owner后续必须对实际TaskId查询，不能猜key或读取另一个Agent的登记。

## 必须验证与退出边界

纯合同反例涵盖version/kind、未知字段、ID错配、有登记严格Stored和absence禁零字段；真实隔离PG涵盖无行、有行、另一执行、store重建/closed finished稳定、旧key-required行为、无写副作用和实际SQL故障。真实Hono路由+session-client跑GET完整链、非法ID、未启用和查询错误；client独立拒绝HTTP故障/错误回应，不用仅DTO断言代替链路。

先限定设计复核再实现，相关回归/类型/lint、独立实现门和单次稳定候选完整门禁分开记录。精确提交仅自有文件，不包含共享迁移锁或RFC037在制文件；新查询无需新表或迁移。共享main最终推送仍待已有迁移/依赖齐备及clean精确SHA CI。本批不是unbound零证明收口，不关闭CS-R02，不开启production或执行真实身份/模型/集群回收验收。

## 2026-09-30 限定实现与验证回执

实现为持久store.lookup→SessionModuleApi.lookupDevelopmentUsage→内部GET /internal/tasks/:taskId/development-usage/registration→严格session-client；复用已有表与存储snapshot，无迁移、生产worker或结束作业接线。实现v2独立静态功能门PASS，11/11路径首尾SHA256一致，未发现P1/P2功能阻断；设计v1与该实现门均不覆盖生产启用或删除许可。

保留验证历史：首轮测试因测试使用未解析的包别名失败，改为现有相对包入口；第二轮发现新增路由直接Zod解析令非法ID返回500，现已采用平台parseParams修为400。第三轮27pass/0fail；首次typecheck暴露两个自有测试的7处字面量推导错误，四个expected对象加as const后修正。最终第四轮真实PG/Hono/client与既有登记/派发/worker回归27pass/0fail/0skip、161断言、7文件，精确11TS ESLint及后端typecheck通过。没有放宽既有断言、增加等待重试或伪造零。

真实隔离PG测试覆盖：成功无行、原有/finished/closed登记、另一实际执行隔离、重建store读取、按key旧404/冲突、查询无写、暂时移走自有测试表的实际SQL故障；实际模块API/HTTP/client在Runner离线时仍读同一PG证据。故障仍HTTP500、存储禁用412、非法ID400；客户端拒绝错误状态/非JSON/错误版本或ID/伪造absence字段。查询未推进ACK、登记或排空，未操作真实身份、模型或集群。

稳定11路径完整候选清单、相关coverage与原始日志在本批会话验证回执中留存。完整check结果、精确发布与远端CI分开追加，未完成者不得写为成功。原consumer965b45e8、派发646da1e9、结束94378917仅本地；共享迁移及对应模块仍待齐备。生产OFF、sourceScope=business-tasks、unbound仍等待，CS-R02和完整RFC保持In Progress。

## 2026-09-30 Session登记查询完整门禁回执

稳定11路径单次完整check于2026-09-30T14:53:28.931660Z结束；原候选及最终HEAD均943789175c1bcfbc216ee49e319ccef9c1e3a9bc，11路径SHA256未变。结构、全仓lint、后端与console类型检查均通过；全量4560pass/143skip/1fail、29303断言、911文件（Bun测试875.05s，整门927.83s）。唯一失败在本批之外的modules/runtime-environment/tests/catalogSummary.test.ts:24，select调用计数期望1实际0；本批11路径没有失败。故不是全绿，保留该共享候选阻断，不改其并行持久层/目录输出，不因无关HEAD变化重跑完整门禁。

限定查询的27项真实PG及合同/client相关回归、11TS lint、独立实现v2门和后端类型通过仍有效；完整门中的143skip包含被明确禁用的真实身份/模型验收，不能代作项目/系统页面实际验收。本批没有真实身份切换、模型调用或Pod回收，也未启用生产开发来源。精确本地提交/远端发布/CI/部署分别待回执；共享锁当时193项中仍8份RFC037迁移未进入HEAD，完整锁和其源码原样保留，待所属会话正常提交并协调发布。新内部查询不依赖新迁移，但不能单独推送仍缺迁移依赖的累计main。
