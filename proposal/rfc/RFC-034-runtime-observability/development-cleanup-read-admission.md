# RFC-034 原开发收尾的跨 owner 只读身份读取

状态：实现候选，尚未发布或部署；真实原 Pod 的数字与物理收尾待完成。

真实执行 `01a11899-ca07-7000-ada8-94539c911c9c` 已经正常取消，原 journal 最终序号与 ACK 均为 3，已逐条核对的七条用量仍是 63,921 Token / ¥0.066516。实际原 Pod 尚未删除；平台 ending 为 awaiting-stop、fence 0。不能把模型取消、数字 ACK 或界面 ended 当成 Pod 已停止。

原数据库只读排查保留全部失败：Task native 作业和开发 ending 回调一直重试；开发回调每轮仅执行 owner.get 和 Task getEnvironment 两个效果，没有进入持久 ending claim。Task 公共 getEnvironment 在 API 分类中是 readonly，却使用带原 Task 回调检查的内部仓库。Task 收尾进入开发 owner 的独立真实 shared admission 后，当前数据库上下文只持有开发 key，回读 Task 身份触发 Original database admission has exited。

新单用例在真实专用 PostgreSQL 与原 Task 模块工厂上实际 0 pass / 1 fail，栈由 getEnvironment 指向上述准入检查；原源文件首末字节一致。它在原 Task 的真实 configEnv 回调内进入另一 owner 的实际 shared 锁，读取原环境，同时验证 Task 的写入仍拒绝借用另一 owner 的准入。

修复只把既有公共 getEnvironment 连接到本模块原只读仓库。返回 DTO、访问 API、原实例和持久选择保持。没有扩大 admission keys、借用原 backend、修改共享数据库准入机制，也没有放宽 Task 写入、作业 fence、数字退出、实际 Pod / Secret UID 或独立停止证明。物理清理依旧先核对 Task 与数字 owner 的原身份、完整或明确中断的持久副本，再由原物理屏障执行。

针对性绿色结果、唯一完整门、准确提交与 CI、部署以及原 Pod 的实际退出另记，不能由这一个回归推断整条真实清理已通过。未启动且未绑定的第二个验证 Agent 仍没有数字退出证明，不伪造零用量或正常完成；其安全取消出口是独立的剩余工作。

针对性核验已完成：原收尾回归 20 pass / 0 fail，新增真实 PostgreSQL 跨 owner 只读回归在修正夹具预期后 1 pass / 0 fail、8 断言。首轮夹具把原已释放环境误期望为 running 的失败保留；现在直接与读取前的完整原 DTO 比较，并保留另一 owner 不能写 Task 的拒绝断言。后续 lint 发现 api 声明可用 const，已仅调整该绑定声明，不改变测试输入、断言、执行或超时。完整门、部署和原 Pod 退出仍待真实验证。
