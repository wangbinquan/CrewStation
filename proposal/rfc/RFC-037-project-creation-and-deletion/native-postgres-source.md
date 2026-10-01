# 原生 PostgreSQL 存储来源与正式 owner 接线

这是已批准 design §6.2 的实施细化。当前 SQL 原 OID/目录执行原语和全部新旧写入能力不能单独开放产品删除；正式 data-control owner 必须同时绑定独立存储来源。只读来源端口已精确发布为 e9eb97b218d2，精确 CI 六项成功，本机八组件和原节点只读探针部署完成，实际 API/控制器的 SQL/K8s/HTTP 联验通过，见[候选与部署验收](acceptance/native-storage-source.md)。它还没有替代每条原生回调的持久 SQL 来源，也没有装配正式 purge owner。

## 已核对的真实边界

`packages/settings/platformSettings.ts:63` 允许 CS_DATA_POSTGRES_ADMIN_URL 覆盖平台库；`modules/platform/wiring.ts:527` 将这个连接注入 data-control，而不是假定它一定等于 CS_DATABASE_URL。外部地址没有已登记的原生来源适配器时，完整盘点须阻断，不能拿本机 postgres-0 的卷替其他服务器作证。

默认安装的 `deploy/k8s/system/10-postgres.yaml` 使用 postgres Service、单副本 StatefulSet 和 data-postgres-0 PVC；PGDATA 是共享卷下的 pgdata 子目录。2026-10-01T07:35:29.985304Z 只读核对实际 Pod e1c096f1-223a-4a78-a67c-d5b66345bcb0、PVC 1cefe909-de62-4307-b517-14aab56ac809、PV 93d700f2-130d-4517-a8be-f031ec9409a5 及原 desktop-control-plane 节点 UID，挂载与 PV claimRef 一致；节点 Ready/Lease 新鲜。PV 实际为 rancher local-path 目录，由共享 PostgreSQL 使用。未重启、改配置或删除上述资源，私有回执 `/private/tmp/cs-rfc037-postgres-installed-storage-readonly.json`。

`modules/data-control/adapters/postgres/databaseReclamation.ts:20` 的 SQL 摘要绑定 endpoint、system_identifier、控制/catalog 版本和 data_directory；这些值可能被备份恢复或克隆保留，不能独立区分替换卷。`modules/platform/adapters/k8s/eventDeliveryOwners.ts:33` 保护的是承载 JS 回调的控制面实例；它的四键停止证明不能冒充 PostgreSQL 服务器/卷的来源，也不能跳过仍持锁的原生 server backend。

## 必须提供的内部端口

data-control L2 接收只读 NativePostgresSource 反转端口，由组合根装配。原管理 endpoint 必须对应可核实的实际 PostgreSQL 服务/实例；SQL 的 server address/port 与平台独立读取的实际端点一致。读取完整 EndpointSlice/Pod 来源，不从第一页或一个名字猜服务器。

原存储身份固定 PVC/PV UID 与精确 claimRef，绑定原数据挂载、storage class/provisioner 及 CSI handle 或 local-path 的原节点/路径来源摘要。CSI 与 local-path 各自需要可观测的实际存储来源；缺失驱动、挂载、节点新鲜性、位置或 epoch 时不补造证明。数据库的全部实际 tablespace 也必须纳入同一原来源清单，不能只绑定 PGDATA 而把外部 tablespace 当作已核实。

当前服务器进程 UID/容器与节点的新鲜回执用于证明观测确实来自原存储。正常服务器重启和存储身份替换必须分开处理：原卷可核实则重新证明当前挂载；无法观察原卷时保持阻断，不能仅采用新服务器 SQL 返回的同一 system_identifier。原生数据库资源身份将 SQL OID/目录与这个独立存储身份一并固定；同操作的重试保留最初身份。

所有新旧 CREATE/ALTER/DROP 回调在持久在途意图中保留最小原生来源；实际原生名字锁覆盖全部命令与迟到退出。主库/PID/租约消失不证明排空。原生来源核对位于取得原锁后及副作用前后；清理须取得全名字原锁，实际 server statement 尚在执行时不能进入元数据阶段。只读 SQL/目录摘要与 K8s 元数据替身分别有明确边界，不把它们组合后的单元用例称作完整实际回收。

## 正式 owner 的完整内容

resources 经公开端口提供全部历史 database/data-binding 原记录与子身份；data 提供旧资源/临时角色/已加密 DSN 的原归属。不能用 capped listLive 或跨 schema SQL 清理旧资源。data-control 自己管理原归属、口令/pending rotation、原 callback、最小 OID/来源/隔离意图和清理回执。

原生历史端口先落实保留台账层：同一只读 repeatable-read 快照内，以原主键续页读尽全部原项目记录及原子对象，不用 OFFSET、listLive 或条数上限。包含停止、失败、压缩和仍在途的 database/data-binding，以及其他种类里意外出现的原生子对象。retainedRecordsComplete 只表示保留台账已读完，不表示全部原生 OID/来源历史完整。records 保留当前声明与原观测 UID；gaps 明确指出压缩清空、旧版本正文未保存、异常声明/归属，正式 owner 必须补齐独立持久事实才能移除缺口。当前 changes 仅保存计数和时钟，不能据此恢复丢失的旧 OID 或暗示清理成功。

seal 在独占原项目准入内关闭所有供给/口令/轮换入口并核对完整范围；drain 同时等待实际 callback 和原生名字锁。purge 根据已确认原 OID 删除原库/角色，保护未知消费者、外部对象及其他项目成员关系；数据库和角色的依赖须按完整集合调度，不能因临时写角色拥有本项目表而形成“先删角色、再删库”的永久等待。正常 DROP 原库会一并清理库内依赖，随后再次普通 DROP 原角色；不转移或删除其他数据库对象。

只有原库全部目录实际归零、原角色及依赖归零、原 callback 排空、全部来源稳定，才能清除口令等内容并给出正式证明。原最小清理意图保留到根 verify；共享 PostgreSQL Pod、PVC/PV、系统角色和其他库保持。

## 下一步必须实际覆盖的反例

- SQL system_identifier 保持而原 PVC/PV/CSI handle 或节点来源变化，原库、角色、凭据不被清理；未知原生 endpoint 阻断。
- 原服务器重启后仍挂原卷的可恢复路径，以及原卷/某个 tablespace 不可观察、读取故障和完整分页失败。
- 主库/生产方已退出而原生 server statement 仍持名字锁，不提前给出 done；实际停止回执缺四键不恢复。
- 两套供给、旧 DSN、临时写角色拥有本项目表、跨库外部依赖、prepared transaction 和全部历史超过一页的盘点。
- DROP/隔离提交后丢回执、同名新 OID、原目录残留、只剩最小审计的最终 verify，以及另一个项目全部资源保持。

当前只读端口通过真实文件系统与 K8s/SQL 来源替身覆盖上述卷/控制文件/表空间替换、旧回执及分页反例；真实探针上仅通过 stdin 执行候选的元数据读取，不把它计作已部署 HTTP 端点或完整原生 owner 验收。未知 CSI/外部 endpoint 和无独立 epoch 的文件系统均阻断；inode/birth epoch 不能证明管理员在同一 inode 上恢复内容的安全性，正式平台恢复/清理协议仍必须关闭所有并行存储变更。

正式 owner、全写入事实的独立来源、正常部署后的 HTTP/SQL/K8s 实际联验和其余实际删除验收尚未完成。创建弹窗已发布；永久删除入口继续关闭，原专用验收项目继续保留。

上段是部署前检查点。2026-10-01T10:18:06.514Z 已部署来源端点，10:35 两个实际 Root 的完整联验通过，原共享卷、节点、全部目录 epoch 一致；首次调用暂不可用没有记录 HTTP 状态，失败原件保留，不称原因已定位。后续正式 owner 仍需全历史、独立来源持久意图、完整排空/清理/verify；当前能力只读，未知 endpoint/provider 或历史身份缺失继续阻断。

2026-10-01 实机原 native 连接的预检复现 inet::text 返回 10.244.232.136/32，严格 IP 校验因此在读取 Service 前拒绝。真实隔离 PostgreSQL 的红回归固定此边界后，SQL 改用 host(inet_server_addr())，保持 IPv4/IPv6 原地址而移除显示网段；语义按 [PostgreSQL 17 网络函数](https://www.postgresql.org/docs/17/functions-net.html)核对。修正后真正原连接和实际 K8s 挂载映射抵达当前旧探针，/source 返回 404；这仅证明前置来源映射和旧协议缺失，完整已部署的 HTTP 联验仍待执行。最新专项 60／0、388 断言、改动行 168／168；完整静态通过后整仓用例中的并行在制失败独立保留，详见候选验收。

2026-10-01 接续候选已把独立来源注入每个真实 native 回调，在副作用前后与全名字 SQL OID 一并独立提交。显式 409 忙碌可在原锁／每轮准入内有限重试；其余失败不成功，后置来源不可读仍保留实际 SQL OID。旧回调全列保持、新增事实 NULL，不能靠当前 SQL 冒充旧独立来源。公开内部 journal 一致快照读尽全保留记录。候选验证与部署边界见[身份记录验收](acceptance/native-identity-journal.md)；正式 owner 和全部物理回收继续。

身份记录兼容性自查补充：尚无已登记独立适配器的外部／CSI 等既有形态继续正常供给并记录真实 SQL 身份，独立来源为 NULL；任何 NULL 都不能开放完整 purge。受支持来源的暂不可读、身份变化和已有原来源后的不可核验均保持拒绝。未发行 0005 在首次发布前定稿，详见身份记录验收；不修改已发行迁移。


2026-10-02 journal已发布部署66556eec，实际Root前后来源HTTP200和原卷身份独立提交已核对；回调内公开历史读取另命中准入注入SELECT之后设置事务隔离的25001错误，完整Root验收仍未通过。journal和resources保留历史均改用BEGIN事务配置保持repeatable-read/read-only；真实PG反例先红，23项修复定向通过，完整检查/发布/重部署和实机复验继续。原探针和共享存储保持，见[本批验收](acceptance/native-identity-journal.md#2026-10-02-精确发布实际部署与准入内快照回归)。


正式 native owner 的接续约束：已开始并提交 DDL 后的项目关闭，可以拒绝调用方继续写入，不能同时拒绝原连接持锁下的只读后置身份采集。隔离 PG 的真实 CREATE/关闭反例已记录已提交角色、finished 与 after=NULL；后续分开这两个许可。主库准入丢失后的实际原生 backend/锁仍须正式排空，不能拿进程退出、当前同名对象或未记录来源补造回调事实。所有库/角色执行器在自己原连接内核对固定独立来源，避免在外层持有全名字锁后再嵌套独立连接的名字锁。最小 scope/回收意图和原 OID/目录/角色集合须先持久固定，原数据库正常 DROP 再处理库内依赖已释放的角色，完整证明后才清除本 schema 口令和 journal。两新增正式 owner 文件可使本模块从38到40个生产文件，不能把ADR草案当增长豁免。
