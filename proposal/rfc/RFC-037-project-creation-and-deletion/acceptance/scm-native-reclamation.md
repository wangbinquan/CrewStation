# 原 GitLab 封写与留存文件实际清理

本批实现可执行的原生封写及描述符清理，继续 RFC-037 全资源永久删除；不把两个底层执行回执当作完整删除成功。

## 原生封写

`packages/gitlab-client/native/fence/runner.rb` 在固定原 GitLab 19.2.4 的 Rails runner 中执行。host 配置绑定原 Docker ID、imageID、StartedAt、PID namespace 和既有服务管理员，HTTP 调用者不能提交账号或脚本。执行前核对原项目 ID／路径／创建身份／存储位置、完整原令牌／机器人／成员出生及独占归属；项目、机器人及令牌锁定后再次检查，再调用原 `Projects::DestroyService#mark_deletion_in_progress`、`PersonalAccessToken#revoke!`、`Users::BlockService` 及 `Ci::AbortPipelinesService`。不排队异步销毁项目、不删除仓库文件。共享账号、身份缺失和替换均在首次副作用前拒绝。

封写回执保存真实 pending-delete／deletion-in-progress、令牌和账号状态、可取消流水线数量及写权限。原实例实际管理员仍有安全文件／令牌接口权限，因此归档或 pending-delete ACK 不能单独认定全部写入及消费关闭。三个完整清理标志保持 false；正式 owner 必须组合全部平台原回调退出、原生消费者来源、父记录销毁及完整留存清理。

私有 handler 在变更前强制核验删除许可，前后核对原实例；SDK 冻结请求、校验完整身份、原请求／事实摘要、时效和 namespace。请求与响应最多 8 MiB，超时 90 秒，固定 Ruby 内部 80 秒；拒绝重定向、未知字段和非法 UTF-8。未绑定真实许可核验器不得开放该 handler。

## 留存文件实际清理

`packages/gitlab-client/native/storage/remover.rb` 在原 embedded Ruby 中清理完整原清单，不加载 Rails，不读取业务字节。host 绑定七类原根目录，不能由请求替换。原清单及当前完整描述符盘点在任何删除前核对；同名替换、晚到或改变的文件、重叠范围、跨设备、符号链接、硬链接及根目录出生变化均拒绝。实际删除只使用已验证原目录的描述符相对路径；每个对象再次核对身份后 unlink／rmdir。父记录消失仍可操作已保留的位置；全部描述符关闭后独立重新读取这些位置，必须明确为空。中断后已缺失的原对象可重放，未删对象仍须保持原身份。

私有清理 handler 强制先核对原删除许可、再核对独立的写入／消费停止来源。仅私有 bearer 或请求中的布尔值不能授权删除。完整存储范围、Gitaly 改名留存目录、全部历史 prefix／外部引用仍由正式 SCM 物理 owner 绑定；这层只证明指定原位置的清理，不把路径缺失扩大成全 SCM 回收。

## 验证

- `/private/tmp/cs-rfc037-scm-fence-readonly-v1.json`：原 GitLab 383、令牌 513／549、机器人 541／577 的当前身份已通过实际 Fencer 的同一校验逻辑；前后原生修订均为 `1d3a759e61b64b01607333b136414d38a7de267a1c164fdc2fa1fb8a245fa634`，原项目没有封写或改变。
- `runner.test.rb`：10 组原执行逻辑检查，覆盖锁定后替换、项目出生／位置变化、共享成员、权限拒绝、真实服务调用顺序、重复封写及停止错误；standalone fixture 不加载 Rails、不打开原数据库。host Bun 用例运行它。
- `/private/tmp/cs-rfc037-scm-remover-ruby-v1.log`：原 Linux/aarch64 embedded Ruby 在独立临时目录中实际删除；12 组覆盖清理、重放、部分删除恢复、同名替换、改变／新增内容、硬链接、符号链接、原缺失位置变化、重叠及根替换。只清理由用例创建的目录，原项目／外项目均保留。CI 的 Linux host 用例运行同一 Ruby 文件；macOS host 验证 Ruby 语法，实际 Linux 行为以上述证据为准。
- 全 GitLab SDK 与 host 组合：68 pass、0 fail、467 断言、11 文件；结构、lint、后端及工作台类型全部通过。相关七个新增 TS 生产文件的执行行全部命中（214／214）；Ruby 行单独验证，不计入 TS 覆盖率。

上一生产基线为 `c9a4c71a05bbb04d4195157dd70ac92a768ec4a3`：六项精确 CI 成功、八组件 Ready、248 项迁移安装并核对，原项目／共享资源保持。创建弹窗已经上线。本批固定候选完整检查已通过：5888 pass／143环境skip／0 fail、223503断言、1170文件、2210.00秒（`/private/tmp/cs-rfc037-scm-mutations-full-check-v1.log`），所有19条候选指纹保持；源码／测试未改变，仅回填本文、STATE及计划。host专项类型已通过（v1临时配置缺少仓库typeRoots的失败记录保留，v2修正后通过），提交／推送状态继续回填；全删除依然需要 SCM 完整物理适配器、Garage、镜像发布、剩余 legacy／未启动兼容、全部生产装配和管理员二次确认实机回收，目标保持 active，入口和普通 producer OFF。

## 2026-10-05 实际发布与下一批接线

封写与实际文件清理19文件已提交推送为 `d10eb3e33393d3241b8d3edf790580c1baa2edd9`，索引清空、main／origin同步，32个外部在制文件没有被提交或改写。六项精确 CI 全部成功：[37256763733](https://github.com/wangbinquan/CrewStation/actions/runs/37256763733)。固定提交通过 Git archive 流入 Docker 构建，没有另建开发 checkout。控制面镜像 `sha256:7a7166dbaa0d1b694878a6ae673d05649df2683dfce6fc92e49e521a69b53c31`、console `sha256:2631c799c4a1357ca0d2081c5925b2c0f6daf13da5f93bd8491b164db2294cdd` 已在 2026-10-05T03:13:33.456Z 部署；八组件全部 Ready，实际 Pod 镜像与节点 OCI source revision 核对，248迁移一致，原 namespace／卷／项目Pod／数据库角色／GitLab身份及固定Runner保持。回执 `/private/tmp/cs-rfc037-d10eb3e33393-deletion-release-v9-deployment-receipt.json`。这是本批真实部署，不代表全删除已经完成。

下一批 `native/destruction/` 与 host 已实现：固定原管理员和原项目身份，在项目锁内复核封写与停止状态后执行正常 `Projects::DestroyService#execute`。独立 Main／CI 盘点直接按原项目、已捕获记录、原机器人、原构建／流水线 ID 查询，父项目消失后仍可读取残留；晚到旧构建的 trace／制品及原机器人的新令牌不会因为关联消失而漏计。只读查询使用 count／pluck 与限定父字段，避免 SecureFile 的初始化写密钥副作用。没有出生字段的子行保留未知并仍计为残留，不删捕获ID对应的子行；实际删除沿核对过的原父项目正常关系执行。

私有请求严格拒绝调用者账号、共享LFS／机器人和已知出生替换，销毁前必需真实许可与独立停止核验；observe 不执行这些变更。原专用项目的实际只读结果为父1、凭据6、流水线2、trace9，nativeRemaining18，原修订前后保持，原项目没有调用 fence／destroy。该新批局部组合80／0、547断言和两侧类型／结构／lint、host类型通过；Ruby14组覆盖父消失仍有子、晚到旧关联、替换、共享、未封写、未停流水线、权限／原生失败及重放。macOS Ruby2.6的测试语法失败已修正并保留日志。

新接线仍是未提交候选，未运行自己的完整本地门禁、无新CI或部署；共享树已有另一个完整check，未重复争用。完整目标继续：实际SCM物理owner与留存搬移／原消费者、Garage及镜像发布、剩余兼容、全部生产装配、二次确认与原项目完整回收。三个物理完整标志始终false，入口与普通producer OFF，不把元数据零或正常原生删除ACK冒充完整回收。


## 2026-10-05 完整范围、消费者和 SCM 工厂接线

原完整 prefix 包括 SQL 行已经消失的文件、捕获的旧月份、Gitaly 删除留存目录；同 basename 的项目/snippet 碰撞只凭原目录出生区分。完整原生和文件材料在既有不可变 jsonb 中持久保存，微秒出生和 uint64 inode 保持，公开盘点不泄露正文。新的固定 `gitLabDeletionPhysicsAdapter` 导出并通过实际私有 HTTP/SDK/原实例读取调用链，正式22方生产安装仍待。

实际源码回执 `/private/tmp/cs-rfc037-scm-physics-readonly-v1.json`：1原仓库、11覆盖、1保留材料、31文件身份，独立 inspect 完整，父仍存在故 prove 正确 waiting；没有 fence/destroy/remove。`/private/tmp/cs-rfc037-scm-activity-readonly-v2.json`：原31身份，全线程消费者0、Workhorse/Gitaly/Sidekiq活跃与本项目队列均0；Rails UID 不能读所有账号 FD 的实际 v1失败保持，v2按原账号只读路由解决，未改账号配置或重启原容器。`/private/tmp/cs-rfc037-scm-consumer-ruby-v1.json`：实际 Linux 8组开FD、已unlink但仍持有、关闭、mmap、munmap、cwd/exe与出生替换通过，仅清理自己的临时文件。完整 prefix 的14组 Linux 临时目录用例见 `/private/tmp/cs-rfc037-scm-footprint-ruby-green-v3.json`。

LFS OID 被新 ID 重建且其他项目引用的真实逻辑回归先红后修，正常销毁后只对原 ID/OID/出生且无引用的记录调用 GitLab 原生 LfsObject.destroy!；正常GC ACK仍不代表文件清理。Ruby18组通过；SDK/host90 pass/0 fail、653断言（`/private/tmp/cs-rfc037-scm-native-tests-v3.log`）。真实 PostgreSQL 的原材料持久化、严格范围和未创建仓库空范围回归以及全部 SCM 模块101 pass/0 fail、670断言（`/private/tmp/cs-rfc037-scm-owner-tests-v4.log`）；最后原查询 v4仍18记录、外引用0、原项目保持。四层静态和host专项类型通过。独立完整门、提交/六项CI和实际部署继续补充，不把受控协议端口当原项目销毁实机验收。


## 正式 SCM 来源与控制器许可入口（2026-10-05）

私有原生服务已以固定原容器、镜像、启动时间、原目录和服务 actor 组合现有读／封写／销毁／文件回收端口；每次 mutation 携带已持久确认的原 SCM retained 材料，来源端向正式 project owner 重新核对当前 operation、generation、phase 与 lease。普通 SDK 写请求或来源 bearer 本身不能取得销毁许可；跨端点写入串行，controller permit 不缓存。平台后台已装配专用许可路由，未配置完整来源时不创建该路由；完整 22 owner 删除仍未启用。

实际 SDK→私有 HTTP→固定原来源协议的组合回归已走通 capture／stop／purge／independent proof，另以真实 PG 的正式 Root 验证伪造 operation 被持久 owner 拒绝且没有创建操作。受控命令替身证明调用与守卫，不能计作真实项目销毁；本机原 GitLab 和 Garage 的本轮核对均只读。

完整 v5 门禁 5924 pass、143 环境 skip、1 fail，223780 断言、1177 文件、2034.73 秒。唯一失败为既有 TaskRuntime 归档／原卷回收复合 PG 用例默认 5 秒预算；定向两用例 2 pass／0 fail、30 断言，首例 4671.77 毫秒。未把重跑当成全仓通过；全部行为断言保留，为该串行真实 PG 集成用例设置 15 秒预算，最终包含正式服务入口的候选重新进行一次完整门禁。日志：/private/tmp/cs-rfc037-scm-native-full-check-v5.log、/private/tmp/cs-rfc037-scm-gate-timeout-target-v1.log。
