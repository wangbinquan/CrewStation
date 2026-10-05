# 正式删除装配与原生工作回收

2026-10-06，RFC-037 的创建弹窗已经上线；永久删除在正式清理服务安装并验证之前仍保持关闭。本记录区分候选验证、提交、CI、部署和专用项目实机回收。

正式 Root 从部署配置构造 SCM、Registry、运行镜像工作、发布工作和对象存储清理来源，并组合全部 22 个资源参与方。缺少完整来源时不开启永久删除；配置不完整或原实例被替换时阻塞操作。

运行镜像与发布工作盘点项目原资源台账、实际 Job／Deployment／ReplicaSet／Pod、配置和凭据，保留 UID 与内容摘要。停止先移除生产控制器，再走资源模块的原 Pod 停止许可；清理回调必须真正退出，不能凭网络断开补造零结果。kubelet emptyDir、全节点进程与旧 inode 消费者独立复盘。

BuildKit 使用实际 native histories、DiskUsage、Bolt 图、快照和内容文件。项目归属同时对照平台项目出生、独立 SCM 完整提交树和模板输入；项目出生前完整的匿名历史保持受保护。仅对明确归属的原 cache ID 和 history ref 发出回收，在原 PostgreSQL 写入排他许可内执行，完成仍须文件、租约、进程和原生目录独立归零。

Registry 清理服务运行于原节点，guardian 独立于操作进程，保留原 PID birth、pidfd、全线程暂停事实和持久 SQLite journal。恢复只有原操作进程实际退出证明才能结清中断记录。每次清理核验正式项目 owner 的 operation／generation／phase／lease，并验证原 namespace、service、Pod、卷、节点、探针与文件出生。SCM 使用原 GitLab 容器与原七类根目录，平台来源 bearer 本身不授予销毁许可。

## 候选证据

- 精确 lint、后端类型与结构检查通过。针对性回归 77 pass、1 个 Linux 环境 skip、0 fail，505 断言、32 文件，使用真实 PostgreSQL。原持有进程快速复核另外 7 pass、33 断言。
- 官方改动行防护计算 1107／1118，99.0%，53 个生产文件，无违规。回执 `/private/tmp/cs-rfc037-native-next-patch-preview-v1.json`。
- 原专用项目只读资格核对保留实际 GitLab project 383、原 BuildKit Pod／PVC 和完整历史；选定 3 个缓存、2 个存储编号和 1 个原项目历史，69 个缓存受保护，没有执行 Prune 或暂停原 Registry。回执 `/private/tmp/cs-rfc037-buildkit-project-selection-readonly-v3.json`。
- 一次完整本地检查运行在冻结的 100 个功能路径上，回执 `/private/tmp/cs-rfc037-native-next-full-v2-receipt.json`；自然终态另行记录，不用针对性成功代替全量结果。

## 部署与最终验收

镜像和私有服务必须来自精确已提交源码，经该 SHA 六项 CI 后安装。先升级八组件与只读探针，加入 kubelet 根的只读挂载；再安装两类固定原生来源，验证 Registry journal 与 SCM 完整只读 HTTP 来源。最后只向五个正式 Root 进程下发完整原生配置，补齐会话／认证／事件进程所需的探针配置，并给会话和认证进程补充 Downward API Pod UID。迁移 Job 不接收这些原生清理配置。

最终验收使用先前批准的专用项目 `rfc037-creation-proof`，检查管理员盘点弹窗、两层确认、取消／Esc 与列表上下文；受理后等待全部参与方真实完成，再独立核对原项目资源、数据库／角色、GitLab 仓库、对象与独占制品消失，受保护项目及共享资源身份不变。安装或局部来源测试成功不能写作项目永久删除完成。


2026-10-06 完整本地检查自然通过：6175 pass／157 skip／0 fail；四层静态通过，冻结的100功能路径首尾摘要全部一致。回执 `/private/tmp/cs-rfc037-native-next-full-v2-receipt.json`。此前失败日志保留。精确提交、确切SHA六项CI、本机部署和原专用项目全部22方永久回收继续，当前不能写作删除功能已交付。
