# RFC-012｜设计

## 已核实的现状

`modules/agent-runtime/application/profileQueries.ts:41` 返回全局档位；`application/resolveProfile.ts:33` 无项目上下文。开发启动在 `modules/dev-session/application/agents.ts:33` 和 `nativeTerminals.ts:24` 解析；业务在 `modules/business-task/application/subtaskLaunch.ts:79` 固定修订；发布在 `modules/release/application/pipelineDeploy.ts:22` 检查引用。开发容器在 `modules/task-runtime/application/createEnvironment.ts:50` 使用平台默认套餐。

## 归属与持久化

项目的算力分配属于 L3 agent-runtime 的档位供给职责，使用其独立 schema 新表 `agent_runtime.project_compute_policies`，不向已超过源码文件警戒线的 project 增添职责。表按 project_id 唯一，存策略 JSON（mode、allowedProfiles、defaultProfile、devTaskProfile）、revision、updated_by／at，无跨模块外键。授权与项目存在性通过 projects 端口，由 platform 注入 project 公开 API。套餐验证使用现有 taskProfiles 端口。保持模块依赖方向，不新建模块或跨 schema 联查。

GET／PUT `/v1/projects/:projectId/compute-policy`；GET 项目成员可读，PUT 仅平台管理员。PUT 使用 expectedRevision，首写 revision=0；原子比较更新冲突返回 409。GET `/v1/projects/:projectId/compute-profiles` 仅返回该项目授权后的租户投影。管理端全局目录保持，作为分配候选。

## 决策与运行链

档位保存 default_visible（新建默认 true，旧档位迁移为 true）；平台默认必须 true，由用例与数据库 CHECK 同时保证。设置隐藏档位为平台默认会原子转为可见。全局租户目录只显示默认可见，管理员仍可查看并授予隐藏档位。

模式为 inherit／restricted。inherit 随默认可见范围变化；restricted 完全使用项目显式清单（可包含隐藏档位），不自动跟随全局变化。inherit 不带清单与项目默认；restricted 默认可为空（显式名称仍可用），非空时必须属于清单且非 terminal。允许清单可为空。任务套餐为空时继承平台默认。

新增受理一律传入可信环境／业务任务的 projectId，先解析项目策略，再调用原档位解析器。default 在受理时替换为项目默认；不在清单内返回 forbidden 与稳定错误码。发布查询传入 release.projectId 并应用同一策略；能力说明与开发下拉按项目读取。已受理实例仍按原固定修订派发，不重新解析 default；新 attempt 重新解析。

新建开发环境在 task-runtime 按项目配置选套餐；恢复检查过滤候选，并在受理恢复时重查配置，防止过期页面绕过。未配置开发套餐保留现有恢复选择能力；已有 PVC 不随套餐缩容。

## 界面与错误

管理项目列表增加“算力授权”入口，进入独立具名编辑页。显示继承／限制、允许档位多选、项目默认和开发套餐。说明空清单、无默认、影响时点；加载失败不展示可提交空表；字段错误逐项显示，写冲突／网络失败保留草稿，重读需明确放弃。复用 Card、FormField、ActionRow、草稿离开保护与 QueryStatus，窄屏不横向溢出。

## 验证

真实 PostgreSQL 模块测试覆盖策略读写、首次并发、修订冲突、授权角色、两项目隔离、默认／空清单／终端／不存在档位、套餐；各调用链覆盖项目 ID 传递和拒绝无副作用。前端测试覆盖表单成功／错误／冲突／恢复、不同项目目录。针对实际页面作浏览器验证；最终只对同一候选跑一次完整门禁。
