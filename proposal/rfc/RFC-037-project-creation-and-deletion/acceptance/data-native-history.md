# data 原生 PostgreSQL 保留历史端口

已批准 RFC-037 的原有 data L3 实施，正式 native owner 的输入准备。复用现有 `api/moduleApi.ts`、`ports/repositories.ts`、`adapters/persistence/drizzleRepositories.ts`、`application/serviceData.ts` 与 `wiring.ts`，未新增生产文件、模块、层或迁移；现有模块仍是123个生产文件，未将 ADR-0012 草案视为增长豁免。

## 行为和边界

公开内部 `data.api.nativePostgresHistory.read(projectId)` 一次只读 repeatable-read 快照，分别按原 id 每页500读完本 schema 的 resources/task_bindings。保留 requested、provisioning、failed、released、rejected、expired、revoked 等全部状态和 legacy_resource_id、task/service 关系、development 哨兵；不使用活动列表或 OFFSET，不按当前 slug 推测名字，也不查询其他 owner 的内部表。BEGIN 配置在实际共享准入前置 SQL 之前生效。

旧加密 DSN 在 data 内解密，只输出原主机/端口/库/角色与密文摘要；不返回密码、明文 DSN、密文、业务错误或审批正文。不调用 envFor、credentialOf、服务解析、资源投影或 provider，不重新供给、签发口令或改项目状态，闭准入后仍可只读盘点。当前 data-control 供给没有 DSN，返回 absent；development 是共享开发绑定哨兵，不宣称为独立 SQL 角色。s3/pvc 保留声明但不冒充 PostgreSQL 来源。

读表完成不代表全部原生物理历史已证明，也不产生 OID、卷 epoch、原写入退出或 gone 证明。解密失败、来源歧义、名字冲突、未知状态/种类/模式均明确保留缺口；数据库不可读、非法原归属或时间拒绝返回完整读取。无法从当前对象填补旧历史。正式 owner 仍需把这个输入与 resources 完整保留台账、data-control 凭据/轮换/实体、原回调 journal 和独立存储来源合并，固定 scope/intent 并真正排空、清理和复盘。

连接串来源仅接受当前平台生成的单地址 postgres/postgresql URI。未知 URI 参数、多主机、缺省库/角色、Unix socket 或非法转义明确阻断，不用 URL 默认值猜原身份；原数据库路径在 percent 解码时保持原文本，避免 WHATWG 点路径归一化改变数据库名。依据 [PostgreSQL URI 连接参数](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS)和[repeatable read](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-REPEATABLE-READ)核对。

## 当前验证

使用已授权并核对 ID/镜像/标签的独占 PostgreSQL 实例 `d12386b3dccd7458ab86544934a982d03f82a6f8cbcd941f493a1c988d1d9c27`，未写共享平台数据库。新端口9项真实 PG 回归加原供给/轮换合计13 pass/0、80断言；较宽9文件51 pass/0、297断言，包括1001资源及1001绑定、跨页及跨表交错独立提交、真实 repeatable read/read only 与 shared 上下文、秘密不泄露、原 alias 和 development 哨兵保持、不可读及坏原记录拒绝。精确 lint 通过。

初次专项7/1失败来自测试误数了本夹具创建的4个资源为5个，修正预期行数后原行为断言全部保留。第一次完整候选静态在本任务的 Drizzle RowList 条件泛型类型错误处失败，没有进入整仓测试；最终固定投影的类型边界修正后重新冻结候选，后端类型及单次完整门禁继续。未把初次失败记为通过。

日志 `/private/tmp/cs-rfc037-data-native-history-targeted-1.log`、`...-targeted-2.log`、`...-wide.log`、`...-full-check.log` 和精确类型/lint 输出保留。精确提交/CI、安装 Root 读取与全项目回收另行记录；当前永久删除入口关闭、原专用项目和共享设施保持，不计完成PD-13/19/22。


最终冻结候选的后端类型通过；提交内容的虚拟 HEAD+精确六路径检查后端/console均0诊断。最终单次完整 `bun run check` 静态四层通过，测试为4954 pass/143环境skip/2 fail、5099 tests、971文件、33154断言、1215.94秒，六个源码/测试指纹保持。两项失败为接口参考面板申请行未到及发布页在读取中就断言；接口测试文件在门禁期间由并行任务修改，所有 console 文件均不属于本发布清单。两文件单独诊断19 pass/0、201断言，当前参考用例含原owner的新等待，故这个诊断不覆盖或替代原全量失败。未更改/提交其在制文件，不再重复未变化的全量；按开发规则§3精确发布并等待自己的 hosted 六项CI。

官方改动行算法核对75/75（100%），所有有运行逻辑的改动文件加载，0覆盖违规；原日志与候选类型/覆盖JSON保留。正式 owner还需核对身份alias registry和旧孤立凭据的原归属，不靠角色同名认领；本端口只声明 resources/task_bindings 两张保留表读取完整。精确CI/部署/实际Root只读验收待接续，永久删除仍关闭。


## cc3efde2 精确发布与安装 Root 只读验收

本批精确发布 `cc3efde22fbd4223065861ea55942cc97936db4a`，CI `36911308226` 六项终态成功。2026-10-01T19:17:26.610Z 八组件 Ready=1；实际控制面镜像 manifest `3be0783c238d68cc87a04ac42c1fd1de3d99c79d08526cb3f15da58fdabaf323`、console `9e6711015677fb279d5e421dc8f0d9db7d7c5378ded80f982ed624bb64967032`。原共享 PostgreSQL/卷、只读探针和策略、原项目及 Runner 保持。

真实 API 原 Pod UID `711891d9-9d6a-4ebb-ae66-ba5f278e0f9b` 的安装 Root 只读验收通过：完整读取 2 条原资源、0 绑定，与独立完整 ID/声明、密文摘要及真实 shared 准入快照一致，回放稳定、无秘密输出。实际 Deployment selector 与 Pod→ReplicaSet→Deployment UID 链核对后执行；最初猜测 `app=cs-api` 的预检零 Pod 失败保留，未执行业务写入。当前全部 **52 库/64 角色**名字与 OID 前后一致；未执行建库、删除、续发凭据或项目状态变化。

回执 `/private/tmp/cs-rfc037-cc3efde22fbd-data-native-history-live-receipt.json`、原 catalog、observer 来源和真实 Root 日志保留。这里证明保留记录读取完整，不能证明旧物理历史完整或永久回收。接续候选把 identity alias registry 纳入同一快照，并通过公开端口组合 resources 和 data-control；见 [原生 owner 候选](native-owner.md)。删除入口仍关闭。
