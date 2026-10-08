# RFC-037 完整项目创建与永久删除验收

验收时间：2026-10-08T21:16:49.087725+00:00。实际运行源码 `05f6acc63d49481e3a3ac6f1cefa16ac2d981ae9`；[准确源码六项 CI 全部成功](https://github.com/wangbinquan/CrewStation/actions/runs/37833112391)。本机八组件实际 Pod imageID／节点 OCI revision 与源码一致，创建、管理员永久删除及原项目资源回收已完成。

## 实际界面

新建项目使用共享 FormDialog；名称、域名标识和模板都有用途说明。标识决定正式域名 `my-app.cs.localhost` 与预览域名 `preview.my-app.cs.localhost`，随输入直接渲染。模板明确说明“用于生成初始代码与发布配置，创建后可以继续开发修改”。最终实机布局、清空后弹窗保持、取消后焦点回到“新建数字人”通过；真实 PostgreSQL 创建前后项目 ID 集合相同、未提交新项目。既有桌面／390／320px、主题、旧书签、长列表上下文回归见创建验收文档。

管理员先核对完整资源清单和风险，再输入 `delete` 二次确认。后台持久清理，可关闭进度并继续同一操作。最终真实界面显示“项目已彻底删除，独占资源已回收。”，原项目链接已从目录移除。

## 原项目完整回收

原专用项目 `01a0f30b-c652-7000-8d6f-553e3b5f6135`（`rfc037-creation-proof`），原操作 `01a11338-80af-7000-a710-9322722ebba4`。最终 succeeded／verify、22 方 × 7 阶段的 **154 份唯一回执**、阻塞为空、仍为两次原确认。原 27／28／30／32／48／51／85／113／129 回执逐份完整保留；四份封存的原 generation、revision、摘要未变。原计划 `01a11947-ccb7-7000-8aa6-68b4bf8d93e3` 在有效期内受理；长清理未重确认、替换操作或重新认领物理来源。

九项独立 AFTER 全部通过且原 BEFORE 未重写：完整保留记录、补充保留记录、外项目完整 Pod 配置、公开业务归属、重建开发资源、25 表原生业务关系、13 项原生物理指标、全目录、最终联合断言。SQL 只读；GitLab 全页、Kubernetes discovery、全部登记内容列和目录均读至 EOF。

独立原生读取首轮因本机 BuildKit 环回端口无监听未能连接；核对原服务／Pod／容器／镜像／节点后恢复指向同一原 Pod 的 127.0.0.1 验收隧道。后续原 GitLab 活动 HTTP 读取报来源不可核实，两份失败日志保持；最终用未修改且与原 SDK 提交一致的正式 Docker 活动观察器直接读取，保持原 90 秒时限、前后实例、完整进程／线程与出生字段、正式解析器和采样新鲜度校验。实际 13 指标全零、69 缓存／49 历史原身份通过。没有把 HTTP 失败改写为成功或更换原生来源；前六份成功证据复核并复用，未重复运行。

| 对象 | 最终实际核验 |
|---|---|
| 根项目、登记项目／服务内容列、原 Kubernetes UID／命名空间／存储 | 目标内容清空；按批准合同仅留最小审计、墓碑及压缩范围 |
| GitLab 原项目 383、源码／Wiki、凭据／原物理材料 | 原 ID、全目录及原生材料核验，目标清空 |
| PG 数据库 OID 276598／276606、角色 OID 276597／276605 | 原 OID、全部名字与目录核验，目标清空 |
| BuildKit／Registry／SCM／原文件消费者合计 13 项原生物理指标 | 全部为零，含原文件出生、完整消费者及原生 RPC |
| 外项目 69 缓存、49 历史 | 原身份和出生保持 |
| 外项目 30 完整业务行、父记录及 25 表关系 | 完整原行和关系保持 |
| 当前 9 个外项目 Pod、全部容器／配置及公开归属 | 全部保持；第 10 个旧工作台及 4 相关对象在目标物理清理前淘汰，原基线及沿革保留 |

## 最小审计与墓碑实际核验

最终验收器旧版只登记五类表名，误把已批准的身份映射与压缩范围判作内容残留；原失败日志保留。173个已登记范围列已全部读取，逐类核对其中38个非零范围：完整限定表名与字段类型严格一致，六个范围的原内容、回调／会话出生数组均清空并已压缩；保留的原生历史只有来源身份、文件／缓存元数据和摘要，正式Schema、原Registry范围与四份嵌套历史摘要通过。原四封存generation／revision／原摘要、154回执及两确认未改。未知表、字段、类型或未压缩内容仍拒绝，没有用宽泛表名豁免。见 `cs-rfc037-i36-minimum-records-assertions-v1.json`。

## 原文件出生身份的真实阻塞

原 BuildKit 目录的 device／inode 被新 PostgreSQL FSM 文件复用，真实 birthtimeNs 不同。生产保留原文件完整三元组；既有私有 Registry 观察服务在同节点／认证／固定原安装读取 whole-host FD、cwd、root、exe、map_files。真实出生不同才区分，缺出生、不可读或真实原消费者继续阻断。实际只读生产装配先证明原 BuildKit／Pod 为零，随后原 release 清理及全部阶段完成。原 PostgreSQL、Registry producer 和原 Probe UID／CID／镜像保持；未按命令、路径或 PID 放行，未扩大 RBAC。

## 原集群网关实体的物理回收补正

原 release 完成后保留85回执，完整45类 discovery 证实 PVC/PV 和工作负载已消失，四条原 IngressRoute／七个原 Middleware 仍在。物理回收之前没有 owner 发起该清理。集群现在仅回收原确认的路由、中间件和凭据；当前 grant／封写、原 API/kind/namespace/name/UID、公开台账及完整子 UID 均重新核验，删除带 UID／resourceVersion 前置条件。保留正常 finalizer，受理后完整 discovery 实际消失才完成。prove 支持同一原操作已有 purge 回执的收敛，旧85回执逐份完整保留；最终 namespace 与所有原对象实际归零。

纯测试提交 daac28f8 修复 private-service 装配，生产字节不变。原两 owner 用例、默认5秒和全部 ACK／独立完成断言保留，实际Linux20／0／111；其他会话 full-v8 的真实6541 pass／135 skip／1 fail保持，纯测试提交准确 CI 37819505920 的模块取消／汇总失败也原样保留；最终运行提交的全部六 CI 独立通过，full-v9在新集群回归的中间态readonly字段赋值处tsc退出2、未进入tests，最终提交用Map.set并以精确typecheck通过。未把这些历史失败改写为PASS，不重复全量门。

## 完整盘点的临时排序空间修复

原操作在 metadata 完成19方、129份回执后，实际 PostgreSQL FETCH 报临时文件磁盘不足；原目标 TaskRuntime 内容与回调均为零，所有外项目历史仍逐行验证。现同一 repeatable-read 只读事务先按原 JSON 主键 C 顺序排序，再以主键索引读取完整原行，200条游标至 EOF、所有 Schema／归属／关系与原 CAS 摘要均保持，主键读取缺失继续拒绝。不删外项目历史、不新增迁移或白名单，不重启原PG／观察服务／Probe。

真实507回调在相同512KiB临时预算下，旧完整行查询稳定失败，新完整快照、相同摘要、外项目完整原行与末页篡改拒绝均通过。256KiB原查询失败及首版游标失败原样留证；没有把旧失败改写为通过。最终源码实际Linux13文件47 pass／0 skip／0 fail、1052断言，以及精确lint／类型／架构通过；正式PG只读SELECT与NO SCROLL游标计划都只有宽度69的主键排序，完整行在之后按主键读取。

其他会话原Linux full-v10为6544 pass／135 skip／2 fail、452940断言，两条data-control原5000ms案例超时；同原源码和预算的有限Linux5／0／55通过，失败原因未确证。原完整失败、所有时限和源码均保持，没有重跑完整门或借有限通过改写全量结果。

## 检查与证据边界

最终 92 项提交指纹核验；此前集群清理补正的实际 Linux 11 文件 55 pass／0 skip／0 fail、465 断言，精确 lint／类型／架构通过。原三条回收反例先红，ACK 不能冒充消失、正常 finalizer 和替换／归属竞态保护均保持。定向运行命令实际 exit0；后处理误用了100条最低数量而 exit1，原日志和包装失败保留，独立 review 核验55条／11文件，没有重跑测试。此前出生能力源码不变，复用已实际执行的原定向证据。真实 PG 定向 131 pass／7 Linux 能力 skip／0 fail、772 断言；同一现有 Linux 只读 checkout／专用 PG 为 141 pass／0 skip／0 fail、819 断言，没有用例重试或延长原时限。精确 lint、后端类型、架构均通过；最终六项准确源码 CI 是完整提交树权威结果。

历史完整门禁 27／34／36 项候选分别 6483／6491／6492 pass、158 环境 skip、0 fail；历史 44 项为 6494 pass／158 skip／1 fail，原失败保持。未宣称最终 92 项本地完整门已执行，不借历史 PASS 替代；其他会话旧 Linux full-v7 的失败也不因本次定向通过而改写。八份验收文档另取准确提交 CI，纯文档不作为运行镜像源码或重复部署。

本机 259 迁移保持，无新迁移作业；控制器实际 2Gi／持久 --smol、默认 Runner 摘要、原 Probe、原生来源及认证均核验，无新模型任务。共享 STATE 包含保留的 RFC-034 并行输出，其余会话源代码在制品排除。

部署前仅按已完成构建的材料摘要回收本任务 23 份旧源码归档输入缓存，保留当前／回滚源码；其他缓存身份、镜像、容器、卷及原 PG／Registry／Probe 保持。首轮过滤无实际回收的失败结果原样留证，后续精确 ID 回收和身份核对分别留证。

原始凭证位于本机 `/private/tmp/`，公开文档不载入认证秘密：

- `cs-rfc037-i36-runtime-sort-complete-terminal-audit-v1.json`：终态／原封存／历史回执。
- `cs-rfc037-05f6acc63d49-i36-runtime-sort-v1-deployment-receipt.json`：实际八实例／原存储／迁移。
- `cs-rfc037-i36-node-birth-native-host-deployment-v1.json`、`cs-rfc037-i36-node-birth-live-readonly-v2.jsonl`：同安装观察服务及实际出生读取。
- `cs-rfc037-i36-independent-after-pipeline-v24.json`、`cs-rfc037-i36-final-independent-assertions-v30.json`：九项 AFTER 与目标／外项目核验。
- `cs-rfc037-i36-original-operation-terminal-wait-v21.json`：原操作 succeeded／154／两确认。
- `cs-rfc037-i36-original-deletion-success-ui-v11.jpg`、`cs-rfc037-i36-creation-modal-final-v13.jpg` 及 JSON：实际成功／创建弹窗／取消零写。

服务器 ACK、标签、逻辑行计数或路径不存在均未被单独作为物理回收证明。
