# 0010. 运行镜像版本与构建归属 runtime-environment 模块

- 状态：已接受；作者于 2026-09-27 批准完整 RFC-028 实现、提交与本地部署
- 日期：2026-09-27
- 关联：[RFC-028](../../proposal/rfc/RFC-028-runtime-environment-builds/proposal.md)

## 背景

平台需要独立于服务发布的镜像源码、构建、已有镜像登记、用途／档位组合验证和引用保留生命周期。作者要求服务、父任务和各 Agent 独立指定镜像；Agent 档位仍拥有模型、协议、凭据和启动配置。把镜像构建塞进 release 会使普通任务依赖发布流水线内部；放进 agent-runtime 则混淆业务工具与平台算力配置。

## 决策

新增 `modules/runtime-environment`，layer 4，按标准脚手架和固定目录模板创建，拥有独立的 `runtime-environment` schema。

- 拥有运行镜像定义、修订、构建／登记、不可变版本、用途／档位组合验证、日志和引用保留协议；不强制服务、任务和 Agent 整组绑定。
- 可以依赖严格更低层的 project、scm、config、agent-runtime、resources 的公开接口；不能 import 同层 release／task-runtime。
- release／task-runtime 自己声明环境绑定、引用、验证等端口，由 platform 组合根回填。agent-runtime 的测试执行器仍通过端口注入，不引入到新模块的反向依赖。
- business-task 可使用低层公开能力；session 若需同层或高层信息仍走端口，禁止读取其他模块 schema。
- Kubernetes 对象写入沿 ADR-0009，由 cluster-control 执行；环境模块只提交台账期望和凭据引用。
- cs-api 挂管理 HTTP；cs-controller 挂持久工作器。应用仍只装配，不装业务规则。

## 后果

按获批 RFC 创建模块、追加迁移，更新结构文档模块表、进程表与相关装配；执行进度以 RFC plan 和验收证据为准。

新模块不承担模型档位管理、服务发布、任务执行或通用 CI。保留这些所有者的接口边界，构建物理生命周期统一交资源中心。复用 BuildKit 参数构造时只提取无领域部分；不增加跨模块 facade，不扩大源码尺寸限制，不申请规则例外。
