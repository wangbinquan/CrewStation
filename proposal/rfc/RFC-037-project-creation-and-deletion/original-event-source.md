# 同标识重建与原事件来源

## 实际反例与范围

原项目根彻底移除后，project 的正式创建接口允许新 UUID 复用旧 slug。已发布 events/0006 的 `project-slug` 墓碑却把新生产方误判为旧项目；简单移除这一限制，又会使删除前已通过 ForwardAuth、但请求正文迟到的 v1 事件按旧编码落入新项目。隔离真实 PG 和正式事件消费者已分别复现，两者必须一并修正。

此修正落实已批准设计中的原身份、迟到重放和重新盘点要求。保留 v1/v2 请求、事件编码、来源头、当前服务、开发与业务任务的合法事件调用；不让名称承担不可复用身份。平台工作负载仍可调用既有平台能力，不能冒充已登记的项目生产方。

## 落位和数据流

- events L3 新增 0007 迁移，只替换本 schema 的归属函数和触发器，0006 保持原字节。旧 slug 墓碑保留为最小历史事实，但准入及新内容归属只使用原项目、服务、producer/type/event/subscription/delivery UUID。未知归属拒绝，不依赖名称补认。
- gateway L5 为全部已观测工作负载保存原 Pod UID，并将 UID、IP、namespace/name 作为内部来源证据交给 identity。现有 service/development 专用绑定继续保留；同名新 Pod 的删除事件不能清掉新 UID 的索引。
- identity L1 声明原工作负载归属端口。platform L6 使用 release 的原 releaseId 或 task-runtime 的原 taskId 公共查询与实际 K8s Pod UID 核对，取得原 projectId/serviceId，现查原项目可用性。只查当前 slug 不足以授权，缺失或不可核实原来源拒绝。
- ForwardAuth 的签名来源令牌增加原项目／服务 UUID 声明；既有名称声明、请求和令牌受众不改。events 固定受众验签、核对当前原 Pod、签名 UUID 与正式归属，并在读取请求正文之前固定调用者。用例在真正写 inbox 前按固定原 projectId 核对生产方与双端准入，正文迟到不重新按 slug 绑定。
- events 的 HTTP 入口缺少签名来源、受众错误、头与签名身份不符、原 UUID 或 Pod 不符均拒绝。直接内部调用也必须给出原项目和服务 UUID。该端口不能用本地缓存或返回名称的替身作为生产授权。

共享镜像滚动时先部署 cs-controller 并确认现存工作负载的 UID 索引完成刷新，再部署 cs-auth、cs-events；旧服务和开发索引由迁移无损回填，旧业务索引只能从实际 Pod 重新观测。ForwardAuth 为每次请求签新令牌，业务端无需变更。滚动前的无 UUID 旧来源令牌不能用于新 events 入口，但不改变其他原协议；重试由新 ForwardAuth 签发后恢复。300 秒令牌寿命不能作为删除或消费者退出证明。

## 验证与边界

须以升级过的实际 PG 验证同 slug 新 UUID 登记和生产成功、旧 UUID 的事件／内容恢复拒绝、迟到正文及删除后才到达的旧来源令牌拒绝、跨项目内容保持。签名链使用正式 key-ring 与 ForwardAuth，不把可信头替身称为加密证明。gateway 验证服务／开发／业务原 UID 索引及旧删除事件，platform 验证原 release/task 与 Pod UID、namespace、IP 的错误分支和其他项目正常路径。

此批只修来源和内容归属，不冒充原事件消费者退出、所有 gateway 元数据 owner、项目物理资源回收或全链路永久删除已完成。
