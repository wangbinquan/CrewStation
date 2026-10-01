# 原生 PostgreSQL owner 候选

RFC-037 批准范围内的 data-control 内部阶段工厂。创建继续使用统一弹窗；本批未开放永久删除入口，原专用实机项目保持。所有 22 个参与者的 Root 注册、旧物理历史核对、其他内容 owner 和管理员二次确认仍须接续。

## 原范围与执行

`modules/data-control/application/projectDeletion.ts` 合并 data/resources 的公开只读保留历史、旧别名以及本模块全部凭据/实体/原生 journal。只接受保留的原 OID、前后独立存储来源及原 PID/start/server。未知旧凭据、NULL 旧 journal、无完整原生事实的名字、同名替换、已经消失却缺少原文件证明的旧 OID 均阻断；当前 absent 或 finished 不代替历史完整和物理排空。

`modules/platform/application/deletion/resourcePhysics.ts:38` 只通过公开端口组合 data 和 resources，不跨 owner 读表、不供给或续发口令。data 的资源、绑定和身份 alias registry 在同一只读快照内完整分页。确认摘要包括上游历史、名字、OID、别名范围和秘密材料摘要；确认后变化先关准入并要求重新确认，不静默扩张范围。

`modules/data-control/adapters/persistence/projectDeletion.ts` 使用实际项目独占准入固定原范围。新增 `0006_project_native_deletion.sql` 保存不可替换的原物理意图和 stop/purge/prove 回执；SQL 核对实际 backend 的 ExclusiveLock、操作、世代和阶段。旧已发行 0004/0005 不变，不补造旧事实。新租约世代沿同一操作、确认和原范围继续，旧世代拒绝；已完成墓碑不可修改，只复用最终回执。

`modules/data-control/adapters/postgres/databaseReclamation.ts` 在原 native 连接及名字锁下核对 catalog、全部原表空间目录、独立来源、真实连接/原 backend/预备事务/复制槽。原库正常隔离和 DROP，再正常 DROP 原角色；不使用 FORCE、全局 DROP OWNED 或强删孤立目录。盘点前跨库对象/外部成员引用阻断确认；途中出现则等待并保留原凭据。依据 [PostgreSQL 17 pg_shdepend](https://www.postgresql.org/docs/17/catalog-pg-shdepend.html)和 [pg_auth_members](https://www.postgresql.org/docs/17/catalog-pg-auth-members.html)核对共享依赖。

排空、物理回收及重新独立复核通过后，才清除本项目密文、待轮换材料、原 journal 和实体。最终再次证明物理归零后清除完整意图，仅留闭准入的最小墓碑/摘要。丢回执、重启及新租约接管按原 OID 和持久意图继续。

## 当前验证

使用独占 PostgreSQL 容器 `d12386b3dccd7458ab86544934a982d03f82a6f8cbcd941f493a1c988d1d9c27`，镜像和任务标签复核。37 项专项通过、260 断言；16 文件较宽组合 **116 pass/0 fail、734 断言**。涵盖真实 DROP/目录归零、实际 prepared transaction/消费者、原名字锁、同名替换、丢回执/新世代接管、1002 条实体/凭据完整分页、确认后历史变化、外部依赖、旧迁移密文保持、孤立旧凭据及跨项目别名。上下游原供给、轮换和 history 也通过。官方改动行算法 **447/452（98.9%）**，无未加载生产文件或覆盖违规。

独立存储端口在这些 PG 用例中为明确标注的受控夹具，不计真实 Kubernetes/PVC 回收证明；真实已部署只读来源另见 native-storage-source/native-identity-journal。内部工厂未注册全部参与者，当前旧项目没有完整 v1 原生历史，不能凭当前 catalog 开放删除。

初次候选的 `$n::jsonb` 文本参数双重编码与夹具清理失败原日志保留；改为 `$n::text::jsonb`。capture 意外带入额外字段导致摘要不匹配，改为只固定 name/OID。外部依赖及确认后上游别名变化均有先红后修回归。初次静态的层依赖、SQL 别名和依赖声明问题已修正；夹具可控 revision 的只读类型失败保留并修正，不改生产契约。

首次失败留下的 10 个本批主库夹具、9 个原生数据库及 11 个测试角色，按精确原名字/OID、未发行迁移校验和、任务容器身份及实际 journal 核对后正常 DROP；其他全部名字/OID及旧 keeper `cs_test_01a0f7a68a837000bc62`（OID `650023`）保持。未清理整个容器或共享平台资源。回执 `/private/tmp/cs-rfc037-native-owner-failed-fixture-cleanup-receipt.json`，原初始失败日志保持。

稳定 31 路径候选冻结后执行本批一次完整门禁，日志 `/private/tmp/cs-rfc037-native-owner-full-check.log`；指纹、覆盖及各次原失败保留。完整结果、精确发布/CI/部署和真实 Root 验收接续记录；不计完成 T8 或 PD-19/22。


## 稳定候选完整门禁

本批一次完整 `bun run check` 静态四层通过，**4976 pass/143 环境 skip/1 fail**，5120 tests、973 文件、33321 断言、1146.54 秒。31 个源码/测试/配置指纹保持；本批新增和较宽原用例全部通过。唯一失败为本清单外 `runtimes/task/tests/businessExecSupervisor.test.ts:65`：shell `sleep 90` 的命令正确终态 exit 0，记录时长 89992 ms，没有满足 >=90000 ms 的断言。该文件/实现均未修改，不将本次全仓称为通过，也不重复未变化的完整候选。原日志与回执保留，按开发规则§3继续精确候选发布，并以本 SHA 全部 hosted CI 为准。
