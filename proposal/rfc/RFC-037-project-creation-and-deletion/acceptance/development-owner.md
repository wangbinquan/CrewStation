# DevSession 原回调与内容 owner 候选

2026-10-03：本批仍为未发布候选，永久删除入口关闭，全部 22 方及实际物理回收没有完成。

- 完整遍历 13 个开发内容家族及原回调目录；确认仅输出数量、原归属和摘要，metadata 清除正文后保留最小封写事实。
- 实际 API、逐原请求／后台派发、普通数字写入和 ending 回调登记共享准入、原 PG backend 与 Pod／Node／PID 出生，私有 finally 保留已经发起的副作用。HTTP 读超时或数据库连接失效不能证明原回调退出。
- 从原实际公有来源核对 project／task／cluster-operation；已受理但尚未创建的子执行只能使用唯一原父工作区。实际组合根保留晚装配 cluster 来源，缺少来源明确拒绝。
- 独立后台迭代包括出生前的 selector，停 worker 后先等该迭代，再等原回调和副作用；封写后的派发候选在 SQL 中排除，其他项目继续。
- 封写、停止、删除、证明、命名空间、metadata 和 verify 的原操作／世代／阶段回执持久化，正文 CAS 删除，过期确认先封写并要求重新确认。
- 停止阶段继续发起本轮其余 owner 的停止，让依赖实际运行时的参与者有推进机会；全部 stop 回执齐全前不会进入 purge。

最新定向 44 pass／0 fail、319 断言，10 文件，实际独立 PostgreSQL。补充类型修正后的 internal/worker/spool 定向通过；精准候选后端类型零诊断，lint 与架构通过。新 0015／0016 已先经真实旧库升级保持全部原行及全新 PG 回归，然后精确追加入锁，共 236 项。证据：`/private/tmp/cs-rfc037-development-final-targeted-v2.log`、`/private/tmp/cs-rfc037-development-typed-targeted-v1.log`、`/private/tmp/cs-rfc037-development-upgrade-v2.log`、`/private/tmp/cs-rfc037-development-owner-types-v5-backend.json`。

51 个功能候选路径冻结于 `/private/tmp/cs-rfc037-development-owner-types-candidate-v5.json`。单次完整本地检查已启动，日志 `/private/tmp/cs-rfc037-development-owner-full-v1.log`，终态应以对应 JSON 的 terminalCounts 和指纹保持为准；当前不能称其全量通过。

这些用例的实际公有归属、价格／Session 端口和 Pod 停止见证由受控端口提供，仅 PostgreSQL、共享锁及私有回调生命周期为实际执行，不能冒充集群物理回收。活跃旧 Agent／CLI 尚有未收尾记录时 owner 保持 waiting；正式 TaskRuntime 的原 stop、数字排空许可、全 Root owner 注册与专用项目实际二次确认回收继续实施。当前普通数字/ending API 封写后拒绝新写，不能把它作为删除期间的专用排空许可。

部署前另查到实际 cs-api 为 uid/gid 1000，已发布报告 emptyDir 未配置 fsGroup。完整共享 `30-cs-api.yaml` 保留观测输入并补 fsGroup:1000，新增运行路径／挂载／非 root 约束回归。此修复将独立两路径发布、等待它的精确 SHA 六项 CI 后再滚八组件，不把未提交 DevSession 输出扫进小批。786489 的已构建镜像未滚；现集群仍为 75dd427。

## 2026-10-04：完整检查终态与夹具修订

首轮 51 路径完整检查已跑完，5560 pass／143 环境 skip／7 fail，136170 断言；全部冻结指纹保持。6 个开发用例失败来自旧库用例只排除 0014 却仍安装后续迁移、用 TRUNCATE 清理受保护正文，以及用旧库腐化断言直接修改已安装新保护的原归属。另一个未修改的发布页用例在新页面仍读取实际部署时提前断言交接完成。原失败及完整终态保留于 `/private/tmp/cs-rfc037-development-owner-full-v1.json`；解析器把 Bun 最后重复的失败汇总算入事件数，校正后的 7 项原执行归属见 `full-v1-analysis.json`，不能按重复的事件数声称 14 项实际失败。

旧库升级用例只安装其要验证的 0014 边界；统计用例每例创建并最终删除独立测试库，保留生产 TRUNCATE 禁止规则。旧库先腐化再升级仍拒绝读取，当前新库另验证原 Agent／工作区链接不能替换且合法 owner 仍可读。发布页刷新后等待实际交接材料落地再断言，原成功／拒绝断言保持。上述 4 文件定向 21 pass／0 fail、195 断言，精准 lint 通过，见 `/private/tmp/cs-rfc037-development-fixture-repair-v2.json`。

目录权限修复已作为仅两路径提交 `d2ab5f349d20a3d24fe564b27024b5ec4dec90e7` 推送，远端精确同步、共享索引为空、未提交开发内容与迁移锁完整保留。该版本从 Git 归档直接构建控制面与工作台镜像，镜像 revision 与该 SHA 一致；没有新的 checkout、任务镜像构建或集群变更。自身 CI 37135430507 仍须取得六项终态成功后才部署，不能借用父提交的 CI。部署准备仅施加已提交报告根／emptyDir／fsGroup 和八组件镜像，保留原对象、存储、任务镜像及其他字段，之后需要在实际非 root API 容器验证创建、同步、回读及清除自己的证明文件。

开发 owner 修订候选排除上述已提交两路径、加入 3 个实际失败用例修订，共 52 功能路径，冻结于 `/private/tmp/cs-rfc037-development-owner-candidate-v6.json`。修订后唯一完整检查 `/private/tmp/cs-rfc037-development-owner-full-v2.py` 已启动，静态四层通过；最终通过仍必须以其终态和指纹保持为准。全部 22 owner、TaskRuntime 原停止／数字排空许可、实际物理范围及原项目二次确认回收继续，删除入口保持关闭。


2026-10-04 终态补记：开发52路径修订完整检查已结束，5564 pass／143环境skip／4 fail，136169断言、1094文件、1559.78秒，全部冻结指纹保持；本批拥有用例71项通过、0失败，静态四层成功。4个失败均在未修改eventsModule测试，起始HTTP500预期收到503后后续依赖状态断言失败；同组单独7／0、63断言，原失败仍保留，不声称全量绿，也不按未变化内容再跑完整门禁。报告目录d2ab5f3自身CI37135430507的module唯一失败是观测10001项夹具hook超时65002ms（3071pass／11skip／1fail），其余static/unit/console/e2e成功；gate失败，尚不部署，已作为实际故障交接观测owner修复。当前正式TaskRuntime、全22方装配／物理范围及原专用项目永久回收仍未完成，入口OFF。
