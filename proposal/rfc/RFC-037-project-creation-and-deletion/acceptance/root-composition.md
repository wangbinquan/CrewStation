# 实际 22 方组合候选

平台现在可把全部 22 个实际模块 owner 接入同一 Provisioning 删除控制器：Project、Provisioning、Gateway、Identity、Events、ApiCatalog、Release、RuntimeEnvironment、DevSession、BusinessTask、TaskRuntime、Session、Data、DataControl、SCM、Config、AgentRuntime、ResourceAccess、Observability、ClusterManagement、Resources、ClusterControl。没有用空报告替代缺失 owner。

正式 SCM／原仓库归属、镜像、发布、对象物理来源通过显式 Root 输入接入；原数据库来源使用既有正式端口。所有输入与原平台 Pod 配置存在、实际模块确实提供 owner 后，才构建控制器及其 HTTP／工作器／持久恢复。默认生产启动尚未配置这些新来源，永久删除仍关闭。这是实际组合能力候选，不能称为全部生产来源已装配或删除已上线。

Provisioning 工厂先构建自己的原开通回调和清理能力，再生成完整参与者集合，解决控制器依赖自己 owner 的循环。Project 提供可信内部的最小协调身份，读取时不借项目负责人身份或管理员 HTTP 路径；确认、重放、租约和阶段证明仍走原公开 API。最终完成把原队列／事件协调内容清除传入 Project 的同一事务，失败时原子回滚。

Resources 的原 Pod 停止与卷回收持久证明接实际 ClusterControl 工厂；全局 PV 按原 UID、claim namespace／UID 与台账归属核对，不借同名卷。运行镜像与发布接独立原回调保护；发布捕获 PID 出生，恢复只接受完整受保护 Pod 的停止，旧 lastState 或仍运行的 sidecar 不算退出，不解除别的 owner 保护。

## 真实集成故障与检查

原实际 Root HTTP 测试在 30 秒预算内超时，日志 `/private/tmp/cs-rfc037-root-assembly-tests-v1.log` 保留。22 个 owner 并行持有本模块快照，再经相同 PostgreSQL 连接池调用公开归属来源，耗尽四连接测试池。盘点改为逐 owner 读取，给原归属端口留下连接；完整范围、各 owner 的一致快照及末尾项目范围复核均保留。相同原预算下实际 Root 测试 2.228 秒通过，没有扩大连接池或超时。

- `/private/tmp/cs-rfc037-root-assembly-tests-v2.log`：25 pass／0 fail、142 断言；实际 Root 管理员 HTTP 返回恰好全部 22 方，Data 原内容确实进入盘点；源故障拒绝受理，非管理员 403，两个原项目及内容保持，删除操作／Data 封写行均未创建。受控不可用物理端口不计物理回收证据。
- `/private/tmp/cs-rfc037-root-assembly-check-v1.log`：整仓结构、lint、后端及工作台类型通过；全部 Provisioning 和 Platform 的 75 文件检查 239 pass／1 Garage 环境 skip／0 fail，2113 断言、124.48 秒。不是整仓所有测试，也不是生产资源验收。
- `/private/tmp/cs-rfc037-root-assembly-patch-v1.json`：包含未追踪新源码的官方改动行 77／81、95.06%，无违规；12 功能路径与 28 项并行内容首尾指纹保持，共享索引空。
- 超时遗留隔离测试库只在原时间窗口、原 Root 两个用户和两个项目同时匹配且没有活动连接后删除；其他 37 个数据库的名字／OID 全保留。回执 `/private/tmp/cs-rfc037-root-assembly-test-cleanup-v1.json`。未创建模型任务或改变原验证项目。

原尺寸／类型／lint 失败日志保留。Root 的开通重试、完整目录装载和主机映射按概念抽出，源码 597 行，未豁免 600 行规则。

## 发布与剩余范围

本候选尚未提交、CI 或部署。上库／部署授权持续有效，自动审批连续两次拒绝必要 git fetch，明确禁止评审环境联网及 Git 引用写入；没有绕过或重试同一限制。缓存 8db68361 不算新鲜远端同步。

正式独立物理来源仍须完成并安装：Data 对象及原回调生产者／消费者闭合，SCM 十一类原生对象与存储，镜像／发布共享引用和底层文件；剩余 legacy／未启动原执行兼容仍须核对。管理员两层确认、输入 delete、原专用项目所有资源实际回收、精确提交 SHA 的六项 CI／八组件部署和浏览器／集群验收继续。入口和普通 producer 保持 OFF，RFC 与总目标不关闭。

2026-10-04 后续：Root 的 Data 普通字节请求现接独立原 PID 出生保护和真实 Project 准入，源码 598 行；原 GET、PUT、验证／删除／检查接线、连接丢失及 body EOF 保护见[原对象请求候选](object-requests.md)。相关实际 Root 组合随完整 Data 检查通过；正式物理来源未安装与生产入口 OFF 的边界不变。
