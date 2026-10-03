# 运行环境项目内容与持久清理候选

2026-10-02，基线 `e40330cde9e337a4f1d0617a98bfb2ebd2357384`。内容来源与准入继续扩展到持久阶段 owner；尚未提交、部署或装配 Root，独占制品实际来源与回收仍需实现。本轮没有对原专用项目或注册表执行清理。

## 正式迁移、回调记录保护与最小沿革（当前候选）

`0007_project_deletion.sql` 已落盘，配套 `projectDeletion.test.ts` 和 `projectAdmission.test.ts` 已进入正常模块用例。迁移在本模块 schema 内增加四类控制记录和三个字段的 `build_provenance`，将平台版本外键移交到不可变的构建 ID、镜像 ID、配方 ID。既有版本必须与原构建和配方逐项匹配，错误指针拒绝升级并回滚全部新表；升级重放不重复执行。新版本只能从真实原构建保留沿革。原构建的日志、执行字段、凭据引用和私有请求可在固定范围全部清掉，其他项目继续引用平台版本。没有把整个构建文档留下作为沿革。

四类控制记录现在都拒绝普通 SQL 删除、倒退或 TRUNCATE。封闭和阶段写入需要真实独占锁及匹配的操作、世代、阶段；实体身份只准在元数据清理阶段追加。回调的项目范围、输入、原进程和退出记录不可替换，出生时同时校验字段类型、身份和稳定项目顺序。正常 finally 用仅保留在原回调内的随机退出密钥写入正确摘要，数据库只存密钥摘要；读取 journal 后伪造退出摘要也会被拒绝。恢复退出仍需独立停止证明，共享回调仅移除待删项目的当前归属。

正式较宽模块验证 **123 pass／1 环境 skip／0 fail、887 断言、37 文件、25.75 秒**；跳过项为未配置地址的真实仓库用例，不能用此前仓库只读证据代替本候选的实际回收。四个专项文件 **41 pass／0 fail、319 断言**。后端全库类型和精确 lint 通过，改动行 **564／567（99.47%）**，没有未加载生产文件。SQL 的等价赋值避免被结构检查误判为外 schema，相关封闭／旧快照／出生校验三个用例另补通过。共享迁移锁尚待串行交接，完整仓库门禁尚未启动；本次不重复跑已有冻结候选的完整检查。

新增红反例确实复现了普通 SQL 改写／删除控制记录和真实共享锁下登记坏回调的漏洞，修复后通过。最小沿革回填初版 SQL 的配方别名与列同名造成误判、TRUNCATE 默认外键拒绝先于触发器、原目录升级夹具缺少真实沿革指针、私有原型落盘后的类型缺字段均保留失败日志，修复后验证。没有放宽单用例时限、加重试或忽略失败。

证据使用 `/private/tmp/cs-rfc037-runtime-registered-` 前缀的 `module-v1.log`／`module-v3.log`、`controls-v1.log`／`controls-v2.log`、`upgrade-v2.log`、`types-v1.log` 至 `types-v3.log`、`lint-v2.log`、`sql-v4.log`；覆盖产物和判定分别为 `cs-rfc037-runtime-owner-coverage-v3`、`cs-rfc037-runtime-owner-patch-v3.json`。真实 PG 与实际本地 JS finally 已验证；Pod／容器／节点与物理清理仍由受控端口提供，不能据此声称平台原实例停止、独占制品字节或容量已回收。Root 尚未装配、完整删除入口仍关闭，所有其他 owner 与原项目全回收继续。

下方保留各阶段历史。最新正式迁移与回归接续以前的私有草稿，旧阶段写明的待实现项以本节为准；未改此前 108 路径冻结内容，没有常规跨会话进度同步。

## 此前持久阶段接续

本模块内部 owner 已按七阶段绑定原操作、世代、确认摘要、原范围与持久回执。模块工厂只有同时配置回调准入、清理许可和独立物理端口时才提供 `api.deletionOwner`；默认模块没有此入口，Root 与管理员入口继续关闭。五类原生来源（builder、验证、制品、凭据、回调）都要求完整盘点，空类别也必须提供来源；已知消费者逐项绑定原输入，原生身份仍由独立来源提供。绑定关系也进入确认摘要，同一批原生 ID 重新映射原输入时必须重新确认。

原 journal 分开保留不可变 `original_project_ids` 与当前 `project_ids`。共享回调清理时只移除当前项目的归属，其他项目继续保留原退出摘要。停止恢复逐项核对当前行的原进程和输入，连接消失不能补造退出。阶段回执使用稀疏映射；最终 verify 即使重放成功回执，也会再次调用独立物理复核并检查完整内容来源。metadata 用每表批量实体标记和 ctid 删除替代逐行 SQL，并与回执同事务；后半段失败会回滚前面的删除和实体标记。最小创建／授权实体键使用摘要，不保留私有请求键原文。

平台构建的源码／初始化依赖也纳入本项目完整构建行和全部日志。平台镜像、配方、版本继续保留；版本还通过外键依赖原构建时报告沿革移交阻断，外项目拥有的构建只报告引用。未发布构建在原消费者和完整独立证明满足后可清内容；已发布版本的最小沿革转移仍待实现。三个同概念合并（schema、分配表并入 tables，构建观察并入控制器）腾出三个文件，新增 port、application、persistence owner，未采用结构例外。

真实 PostgreSQL 私有组合最终 **27 pass／0 fail、178 断言、9.78 秒**；注册的内容／控制器组合 **20 pass／0 fail、154 断言**。本轮原失败包括稀疏回执、旧 verify 回执、回调行替换、大批逐行超时、遗漏来源构建、遗漏已知消费者与确认摘要缺绑定；修复后通过，没有放宽原五秒单用例时限。大批元数据和未发布构建的 2001 条日志都按原范围完成。后端全库类型、精确 lint 与结构检查通过。独立物理端口在这些用例中为受控实现，不能当成实际平台进程退出或存储容量回收。

证据为 `/private/tmp/cs-rfc037-runtime-owner-prototype-v10.log`、`module-v2.log`、`types-v5.log`、`lint-v4.log`／`lint-v5.log`、`arch-v5.log`，文件名前缀均为 `cs-rfc037-runtime-owner-`。原失败日志保留；SQL 与 owner 回归仍在私有草稿中，正式迁移／回归注册、控制记录写保护、最小沿革转移、独立物理实现以及全部 owner 的 Root/API/UI 接续仍待完成。本轮未启动完整门禁或发布，未改共享迁移锁和已冻结的 108 路径；没有发送常规跨会话进度消息。

## 此前准入协议接续

构建、验证、源码准备、初始化 Secret 与 builder 凭据读取已接入可配置的原回调准入。一个实际数据库 backend 按稳定次序持有来源项目共享锁，普通 UOW 仍独立提交；先保护原进程并提交 journal，再进入回调，原回调真正返回／抛错后的 finally 才记录退出。连接消失可先释放 SQL 锁，但尚未返回的回调仍保留在途记录；迟到 SQL 与外部调用不能借原会话变量继续。验证心跳会检查项目状态和原准入。

私有 SQL 草稿增加四类自有控制记录，分别用于永久封闭、原实体身份、最小准入标记和原回调。普通内容写入核对真实锁持有者，并持久更新准入行，使封闭前的 repeatable-read 快照不能在 seal 后复活项目；TRUNCATE 内容表也拒绝。完整 fence 文档移除后，最小封闭标记仍保护普通写与外部回调。平台镜像／版本的普通维护不因原配方项目封闭而被禁用。

内容来源识别完整控制表形状，并把本项目原 journal（含多项目共享回调）纳入同一快照。Pod／容器／节点、原 PID／启动时间和退出摘要绑定到原 callback；缺失控制表、错误摘要或项目来源阻断完整证明。永久身份标记保留为最小墓碑，journal 不被当作已清空。该批没有新增生产文件、模块或 schema 转移。

真实 PostgreSQL 私有原型最终 **13 pass／0 fail、69 断言、2.57 秒**，覆盖等待原回调、另一项目独立写入、伪造会话变量、断线后原 finally、旧快照、实际控制器接入、心跳、源码／初始化／builder 凭据及计划替换。相关模块组合 **19 pass／0 fail、144 断言**；计划快照类型修正后 builder 组合另补 **3 pass／0 fail、20 断言**。精确 lint、架构检查和后端类型通过。原型使用真正的本地 JS 回调与真实数据库，但 Pod／容器／节点来源由受控端口提供，不能算实际平台原实例退出、制品清理或容量回收。最初私有 import 路径错误、Bun 未结束的异步断言及 TypeScript 身份覆盖／计划收窄问题保留失败日志，均已修正。

私有草稿与原型为 `/private/tmp/cs-rfc037-runtime-admission-draft.sql`、`cs-rfc037-runtime-admission-prototype.test.ts`，回归／类型证据使用同前缀的 `prototype-v11.log`、`module-v2.log`、`secrets-targeted-v3.log`、`types-v5.log`、`eslint-v5.log` 与 `arch-v3.log`。原六路径交接已撤为在制；新 SQL 尚未落入正式迁移目录或共享锁，正式回归落盘与阶段 owner 继续。未启动另一轮完整门禁，此前 108 路径冻结交接的内容摘要保持一致；Root 未接此准入或 owner，管理员删除入口没有因此开放。

## 完整来源与归属

`runtime-environment` 的 `RepositoryScope.projectContent` 独立读取十二类实际表，不复用管理目录、历史列表或日志分页限制。所有表的内容在同一 SQL 语句快照中读取；先核对完整表／列清单，未知或缺失项拒绝完整证明。公开结果只含记录键、内容摘要和原消费者身份，不包含配方、凭据、验证输出或构建日志正文。

本项目授权、开发策略、镜像策略、创建／资源回执、验证与执行引用纳入元数据。已过期引用仍纳入；旧 builder 和依赖本项目来源的平台注册 builder 的完整行与全部日志独立盘点。平台目录的镜像、配方和版本保留；平台版本仍引用构建记录时明确阻断，需要先移交最小沿革，不能直接删除有依赖的构建行。

固定源码／初始化依赖另行列出；消费者来源包括本项目验证、旧项目 builder 和依赖本项目来源的平台注册构建。资源 ID、执行 epoch、原 Pod UID 和构建计划摘要与当前内容修订分开，租约续期不会替换原物理身份。列／文档归属和对象 ID 冲突、非法旧项目键、在途验证缺少唯一同项目原版本快照均阻断。此清单只为后续封写、排空和回收提供输入，不证明消费者已经退出。

源码位于 `modules/runtime-environment/ports/{repositories,unitOfWork}.ts`、`adapters/persistence/{lifecycleRepositories,unitOfWork}.ts`；七项真实 PostgreSQL 回归位于 `tests/projectContent.test.ts`。既有 ADR-0012 拆分提议没有被解释为结构例外。

## 用例与静态结果

- 较宽运行环境组合：**88 pass／1 skip／0 fail、630 断言、35 文件、12.64 秒**。唯一跳过是真实仓库地址未配置的用例，随后独立补跑通过。
- 显式类型收窄及快照索引完善后，最终内容回归 **6 pass／0 fail、60 断言**。2002 项在途验证与末项损坏在原 5 秒时限内通过（466.48 毫秒），没有逐验证扫描所有引用的平方增长；后端全库类型通过。此前遗漏的 `Content | undefined` 类型问题已修正，失败日志保留。
- 精确 lint 和架构检查通过；最终改动行 **92／92**，没有未加载生产文件。完整仓库门禁仍按已有联合交接执行，本任务未另启一轮。
- 两个进程内负向控制分别移除内容收集和在途快照检查，真实用例均失败；工作树源码没有临时替换。最初两份 SQL 夹具错误（参数缺少类型与 UNION 排序表达式）保留，修正后完成验证。

私有证据：`/private/tmp/cs-rfc037-runtime-content-module-v7.log`、`targeted-v10.log`、`types-v11.log`、`patch-v10.json`、`negative-v4.log` 和 `negative-origin-v6.log`，文件名前缀均为 `cs-rfc037-runtime-content-`。大批夹具的初版因错误复制原引用 ID／非 v7 验证 ID 而被身份保护拒绝（v9），修正夹具后 v10 通过。

## 真实注册表读取

通过仅绑定本机回环的临时 port-forward，补跑原有真实仓库生命周期用例：**1 pass／0 fail、13 断言**。读取的平台注册镜像为 `crewstation/task-runtime@sha256:dfa2f2461bb6243fbf0a61908c5e3bcd30db62d1e1b69c1d529e272dd4405bde`（arm64）。元数据操作仅发生在隔离测试数据库；外部 builder、资源声明和凭据端口调用为零。验证仍是既有 `service-contract`，不是实际 Runner 执行证明。

前后核对原 registry Pod UID `1d82a6a0-ede8-4e65-b8be-33f0cc519c71`、容器 ID 与节点相同；原 manifest 字节摘要保持。实际 Deployment 为 Distribution `3.1.1`，配置了 `REGISTRY_STORAGE_DELETE_ENABLED=true`，但本次只读请求没有执行原生删除或 GC。退休结果仍为 `pending-maintenance`，不能作为存储容量回收证据。临时 port-forward 已结束。

实际读取／身份回执位于 `/private/tmp/cs-rfc037-runtime-registry-readonly-receipt.json` 与 `cs-rfc037-runtime-registry-after-readonly-receipt.json`；实机用例日志为 `/private/tmp/cs-rfc037-runtime-content-live-registry-v8.log`。

本批没有改变共享迁移锁、Root 或此前 108 路径冻结交接。全链路二次确认、全部 owner、原专用项目实际永久删除和容量回收验收继续，不以本批内容盘点关闭 RFC-037。

## 2026-10-03 精确发布与本机部署回执

本批与观测会话的就绪内容已串行提交并统一发布：本任务 61 路径为 `463f24d85b0e6edfc8fbf984758be3f2c585d400`，包含其前序 `a6021a88` 和完整 216 项迁移锁；共享 STATE 与平台来源夹具的并行输出完整保留。[该 SHA 的 CI](https://github.com/wangbinquan/CrewStation/actions/runs/37060038342) 六项均终态成功。2026-10-02T20:34:54.250Z 八个本机组件完成部署，实际 Pod imageID 和节点 OCI 的 source revision 都对应该 SHA。控制面 digest 为 `495313d740dee1a76bbdd0adaec0b0aca8e81110bb188ac3d5b540487955301f`，工作台为 `9fcfd35062a78d2f4e75e812df5fceb7f732912c4925a289d4587a93d21eaec2`。

release/0009 与 runtime-environment/0007 的安装校验和分别为 `9fb0caab1f7a578102d521f778a0b19103eb7c58a5e4ad7142d2f656f0c81a92`、`c55ec5f13818fba2f02bd928dde884f3a6c6618811db9df28165a8b542ea51d7`。原固定 Runner、GitLab 容器、平台 PG/PVC/PV、所有项目 Namespace/Pod/卷及 52 库/64 角色的身份保持；发布后 main/origin 为 0/0、index 为空，其他在制路径保持。私有终态回执为 `cs-rfc037-runtime-release-publication-receipt-v1.json`、`cs-rfc037-463f24d85b0e-exact-ci-v1.json` 和 `cs-rfc037-463f24d85b0e-runtime-release-v1-deployment-receipt.json`。

此回执证明本批发布、迁移和部署，不证明完整 22 owner 或独立物理来源已装配。删除 HTTP 尚未开放，原专用项目未删除，全资源回收继续验收。后续 SCM 当前归属接续是另一份在制候选，不属于上述 SHA。
