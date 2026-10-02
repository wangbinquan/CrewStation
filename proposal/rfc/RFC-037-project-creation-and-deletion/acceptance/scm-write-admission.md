# SCM 原回调准入与副作用沿革

本批补齐正式 SCM owner 的持久输入，不开放永久删除入口。创建保持统一弹窗；专用原项目与原远端仓库仍保留。SCM 回调退出、封写以及远端 API 受理，各自都不等于 GitLab 消费者已排空或物理文件已回收。

## 实现与原身份

- `modules/scm/adapters/persistence/repositoryAdmission.ts:31` 在真实共享项目锁内、外部请求前独立提交原回调事实：原项目／服务、工作 ID、数据库 backend、Bun PID／启动时间和实际 Pod／容器／节点来源。来源未配置时明确保留 NULL。
- 同文件 `record` 独立追加请求意图与实际返回的数字 ID，早于普通绑定／凭据提交。建仓结果另有不可变原远端沿革，失败重试不会覆盖早先远端 ID；秘密令牌、哈希、消息、工作目录和引用原文不进入公开 journal。
- `modules/scm/application/projectAdmission.ts:7` 与普通 SCM UOW 共用原准入，覆盖建仓、模板写入、标签保护、代推、标签、两类凭据签发／撤销与旧 URL 回填。SQL 同时核对实际 backend 共享锁，伪造 GUC 不能替代真实准入。
- `history` 在单一 repeatable-read 只读事务读取全部绑定、全状态凭据、最小原身份、UUID 别名、回调和远端沿革；不设置分页截断。未知 SCM 表和不能归属的旧凭据阻断完整性。
- `close` 验证真实项目清理许可并在排他锁下持久关闭同一原 projectId；旧服务／凭据身份保持不可改写。`recover`／普通观察只有在可信原容器实际停止且原 PG backend 已无共享锁后，才保存中断退出事实。
- 平台各进程使用独立 `crewstation.io/scm-project-stop` 保护；清理 SCM 的保护不移除网关、数据库、事件或外部 finalizer。同一个平台 Pod 仍有活跃来源时不会被当作已停止或整体强杀。

新增迁移 0005／0006 均精确入锁。0005 首次锁定后曾有未提交的补充草稿，已恢复首次锁定的逐字节内容（SHA-256 `c57c665e85adb3a485389db5f18425f9eea01ce23581fbb16f6219f0734b5605`）；补充以 0006 追加，未修改已锁迁移。旧绑定只保留原数字 ID／路径，远端创建时间与旧回调来源保持未知，不制造历史。结构检查器对真实 SQL 裸别名和触发器自身复合行变量补齐语法识别；对象位置、外 schema 类型和函数调用仍严格阻断。

## 回归与候选检查

先红：旧实现的四条 journal 回归 0 pass／4 fail；裸 SQL 别名规则的正例先失败。后续失败原件保留：一个错误类别断言、懒 thenable 的拒绝断言、包别名子进程夹具及旧 SQL 位置 INSERT，均在保持实际拒绝条件后修正。

最终 SCM＋协议较宽用例 **84 pass／0 fail、537 断言、16 文件**，真实隔离 PostgreSQL 开启 prepared transactions，并使用原本机 GitLab 的隔离集成夹具。八条新增真实 PG 场景覆盖：正常回调及秘密排除；原共享锁与排他关闭竞争；原始远端成功但响应丢失；实际 PG backend 被终止后迟到结果留痕且普通 UOW 拒绝；实际独立 Bun 子进程 SIGKILL 后恢复；1001＋1001 旧绑定／凭据升级；绑定保存失败但原远端事实保留；失败绑定覆盖时保留两个原远端 ID。SIGKILL 只作用于本用例创建的子进程，受控容器来源端口不计实际 K8s 停止验收。

原进程保护的最新专项 **10 pass／0 fail、58 断言**。Root／结构规则组合首次 42 pass／1 fail，唯一失败是另一会话 `resources/0009_maintenance_sweeps.sql` 未入锁，原失败不删除。结构语法专项 3／0、11 断言。全部本批生产文件有用例加载，改动可执行行 **234／240（97.5%）**，无防护例外。

精确本批源码 lint 通过；提交树原内容加本批文件的内存视图验证后端与 console 各 **0 类型诊断**。共享工作树类型检查中的另一会话 `task-runtime/domain/development/parentEnding.test.ts:57` 错误未代改。本批 SCM 保持 40 个生产文件，不新增模块／layer／schema 转移，也不改结构规模上限。

39 个源码／用例／SQL／锁文件已冻结并运行一次完整门禁；结果与精确发布、CI、部署及实际 Root 回执接续记录。正式 SCM owner、独立完整 GitLab 物理来源、全部参与者装配与管理员二次确认仍继续，不能以本批通过缩减已批准的完整清理目标。

## 正式后台观测与最终候选门禁

自查发现 `revokeExpiredCredentials` 原本没有正式进程调用，不能把它当成持续观测保障。现在 SCM 自己暴露可停止、单实例不重入的 observer，由 Root 的 controller 后台生命周期实际启动，10 秒重读原来源；失败仅保留保护并记录不含秘密的警告，不强杀共享进程。两个红后绿回归验证重复启动、在途停止等待和失败后重试；Root 回归核对它在 controller 中且不在 API 后台重复启动。

最终源码与原进程／Root 组合为 **98 pass／0 fail、609 断言、19 文件**，改动行 **244／250（97.6%）**，无防护违规；候选两侧类型仍为 0 诊断。首遍完整门禁为 5019 pass／143 skip／11 fail／2 errors，运行中因补上正式 observer，四个源／锁指纹变化，因此不当最终候选通过。第二遍 `bun run check` 的 **41 个 SCM／Root／规则／SQL／锁指纹全部保持**；静态四层通过，完整测试 **5018 pass／144 skip／13 fail／2 errors，33602 断言、982 文件、1263.27 秒**，失败原件 `/private/tmp/cs-rfc037-scm-writes-final-check.log` 保留。

十个 resources 失败源于并行维护控制表未进入删除来源登记，RFC-034 原物理清理压缩回归仍缺维护 owner 接线，均交原会话修复。预备事务反例的 55000 来自该次未设置隔离 PG URL、默认实例 `max_prepared_transactions=0`；相同未改动用例在已授权隔离 PG（该值为 10）定向 **18／0、134 断言**，只关闭这项环境原因，不宣称完整门禁通过。另一个文案键失败是后来准备的未挂载删除视图被扫描到时，进程已缓存旧中文表；补齐双语后独立文案回归通过，见[视图验收](deletion-dialog.md)。

共享迁移锁包含另一会话的 resources/0009 与本批 SCM/0005、0006。用户明确授权跨会话协调，双方保留完整共享锁和对方未提交源文件；全部相关依赖就绪、在短临界区串行精确提交后才推送。未执行本批部署或真实永久删除；原项目和全部共享设施保持。

2026-10-02 共同唯一完整门禁实际通过：**5071 pass／143 skip／0 fail，34004 断言、991 文件、938.51 秒**。104 个联合候选路径首尾一致，既有隔离 PG 身份保持、预备事务能力为 10；原 SCM 47 与后续 15 路径内容均在此快照中。原件 `observability-cs-maintenance-joint-full-check-v1.json/log` 保留。观测源码 SOURCE v3 PASS 的范围包含此前失败的资源维护登记与接线，不扩大为完整 producer／父结束链路验收。共享 Root 与完整锁已由另一会话 44 路径 commit-only `374602d8916ec9edfaa1427d8beda153199f858d` 保留全量提交；本任务剩余源依赖串行精确提交后累计推送，等待最终累计 SHA 的 CI 与部署。未挂载删除视图与正式物理清理的剩余边界不变。

## 累计精确发布、部署与真实原回调验收

另一会话 `374602d8916ec9edfaa1427d8beda153199f858d`（44 路径）、本任务 `34d19685ef9852524213ad996ad9d46bb222e954`（52 路径，含四删除）、后续独立 `f78c27ad377d583d407d9ca531b9c776d1266339`（17 路径）累计精确推送。113 个核验路径和全部迁移锁依赖都在最终提交树；main 与 origin 一致，暂存区空。没有提交另一会话后来新增的父结束存储五路径，没有更改 SCM 0005／0006 校验和。

最终 SHA 的 [CI 36961250201](https://github.com/wangbinquan/CrewStation/actions/runs/36961250201) 六项全部终态成功。从此精确提交树构建镜像，不包含未提交工作；**2026-10-02T04:00:27.743Z** 八组件滚动部署完成，原存储探针／策略、Runner、共享 PostgreSQL Pod／PVC／PV／节点／Service 与原项目 Namespace／Pod／PVC／PV 的身份保留。

实际 API Pod **2cb2ecab-32d0-47fb-84c3-90a38ea8386a** 内加载部署后的 Root／SDK，原 383 身份、SCM 两条迁移校验和和旧来源未知时间核对通过；只签发本用例五分钟 build 凭据再撤销，普通元数据之前的 intent／returned 及真实 PID、Pod、容器、节点、退出摘要留痕通过，两条新回调历史只读重复稳定且无明文／密文。既有 GitLab 令牌保持，全部 **52 库／64 角色** 名字与 OID 前后完全相同；原项目对象保持。本次凭据已撤销，回调与副作用历史留作后续正式 owner 的原范围，不伪装成已回收全部 SCM 资源。

私有原件为 `cs-rfc037-coordinated-push-receipt.json`、`cs-rfc037-f78c27ad377d-ci-terminal.json`、`...-deployment-receipt.json`、`...-scm-writes-installed-live-receipt.json`。正式 SCM owner／全部独立物理来源、剩余 owner、Root／API／UI 与原项目永久回收尚未完成，产品永久删除入口仍关闭。
