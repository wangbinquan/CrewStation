# 网关 owner 的封闭、共享文档与原回调退出

本细化落实已批准的 T6、T10、PD-10、18、20，不新增产品选择或改变删除范围。网关负责路由期望、Pod 身份索引、维护、限流及全部历史放行文档；原 IngressRoute、Middleware 与命名空间的物理回收仍由 resources/cluster-control 按原 UID 证明。

## 原身份与内容范围

最小关系只存原 service/pod/operation ID 与 projectId，及每个放行文档 version 内原 caller/operation 的 projectId。caller 字符串不能在同标识重建后重新认领旧版。API 目录公开 operation 最小归属读取；平台通过 project、release、task-runtime 公开 API 解析原服务和已观测 Pod 的发布/任务沿革。识别不出的目标历史内容阻断，不按同名新根、Ready 或 IP 猜归属。

文档只移除本项目 caller、operationRoutes、defaultOpen 和其他 caller 中指向本项目的 operation ID，保留其他项目原文、顺序与其余字段。全部历史版本分页处理；未知表、畸形文档、未知原身份或归属冲突阻断。平台默认限流、共享目录及其他项目维护保持。

六张内容表按原主键继续分页，避免其他项目删掉前页记录而跳过目标后页。启动恢复登记最新版文档的最小原关系；请求读取保持纯读，根项目状态一次批量核对，旧安装不用在每次判定时遍历授权键的跨模块目录。

## 准入、缓存与迟到副作用

数据库写入使用原 projectId 的 shared 咨询锁和本 schema 触发器；seal 等在途事务退出后持 exclusive 锁，核对正式 project 许可和完整确认修订。范围变化持久关闭准入并要求重新确认，普通重试不替换摘要。原 service/operation/pod 关系不可重写。

路由及限流投影在外部调用前持久登记原 workId、projectId、backend PID 和原 Pod/container/Node，再执行实际回调。finally 用独立事务登记原退出；PG 掉线、租约失效、同名新 Pod 或 Pod 缺失都不表示结束。重启只接受原容器在新鲜原节点上的真实终止摘要，保留其他 finalizer。实际工作未退出时 seal 返回 waiting；正式生产原进程来源缺席时拒绝开始副作用。

每请求放行表视图重新按原归属和持久封闭事实裁剪，进程内旧缓存不能继续放行旧项目及其接口。维护缓存读取也核对原项目封闭。旧 Pod 观测、重放和全量调和不能恢复内容；原 UID 的仅停止观测可继续，以免挡住停止证明。

## 落位与结构

- ports/repositories 承载本模块原身份目录、准入、实际进程与清理端口；application/projectDeletion 编排七阶段结果。
- adapters/persistence/projectDeletion 保存本 schema 的完整盘点、屏障、回调与退出事实；新 0011 迁移不改旧文件。
- 路由/限流/身份/放行/维护用例经反转端口使用；HTTP 不引用端口或适配器。
- platform/wiring 只接公开 API。实际原平台容器适配器按 participant 使用独立 finalizer，events 既有语义保持。
- schema 单声明与限流 receipt 表归并到原 tables，限流协调函数归并到原 drizzleRateLimits，保留事务和函数行为。网关生产 TS 由 41 减去 3 再新增 2，最终 40；不新增模块、调 layer 或放宽尺寸上限。

## 必须验证

真实 PG 验证无损升级、超分页历史文档、共享原文保护、直接/间接归属、原 ID 重写拒绝、同 slug 新 UUID、旧缓存拒绝、新确认世代、正式许可缺失/失效、未知表/文档阻断。独立实际回调在 PG 断线后仍存活，seal 等待，原 finally 或原容器证明才排空；替换 UID/Node/container 及直接改状态均拒绝。假 K8s 只证明适配行为，后续仍须专用项目真实路由 UID、停止和物理清理对账，不能以 metadata owner 关闭完整目标。
