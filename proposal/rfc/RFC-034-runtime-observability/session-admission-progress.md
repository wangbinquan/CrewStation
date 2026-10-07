# 实际开发验收：Session 握手准入的进展保证

状态：设计审阅 VALID/PASS，实现候选；整体 RFC 仍 In Progress。来源：用户要求完整统计及真实任务验收；2026-10-07 新 r3 的原运行日志、PostgreSQL 活动与原源码。两个 RFC 仍 In Progress。

## 原始事实与问题

已部署 e8fa78ad 的原 cs-session 于 09:25:10 UTC 因 postgres 3.4.9 的 nextWrite 对 null socket 调用 write 退出。重启后的原 Runner 反复在 120 秒周期收到 1011；新两个 Agent 的完整事件流没有 EOF，不能补零或称统计通过。实际数据库四条会话连接都持有 session.project-admission 的 shared advisory lock，最后查询是 pg_backend_pid，尚未登记新 connection birth，随后被原 60 秒事务空闲保护终止。

原 runnerLifetime.open 用 sessionConnectionHistory.open 包住整个 hello。hello 内 verifyRunnerToken 和 onRunnerConnected 调用 TaskRuntime 的 task-0 原 owner API，再从同一 max=4 准入池申请不同 owner 的准入事务。四条 hello 各占一个连接时，无法取得任何下一层连接。命令／事件的并发进展另外用原真实 WebSocket 验证；尚未取得该链路故障证明，不在本片改变它的顺序语义。

## 要求与拟定修复

1. 身份校验、TaskRuntime 的连接状态回调、原令牌／原环境检查都保留，由各自原 owner 准入保护。Session 准入只包住原 connection birth 的重新核对和持久登记，在 runnerLifetime.register 内进入，不包住跨 owner 的 hello。open 仍跟踪完整原 hello Promise，shutdown 仍等实际握手结束；原 welcome 必须在 birth 持久成功后发送。拒绝、旧原归属、删除中项目、换原令牌和关闭期间的握手都不得成为有效连接。Session 登记后的异步 ready 派发不继承已结束的准入。
2. 原 event/result/error 串行处理与 legacy 归一化保持。hello 前后突发事件仍按 seq 去重、实际持久化后广播；结果不超越前置事件，不改消费者既有时序。
3. 原 command Promise 仍包含登记、wire、回复持久化和私有 finally，close／shutdown 仍等待这些回调与数据库事实。原生用量 ACK 仍在全部原副本持久化之后发送，不能把一次 welcome 或命令回执当成用量 EOF。
4. 不增大连接池，不修改 60 秒事务保护、原 wire 时间预算、统计人口、页 EOF、费率、任何结束证明或 project deletion fence。现有 guard 断线、拒绝以及原 callback finally 回归完整保留，不吞未捕获异常。

## 回归与交付

先新增真实 PG 与原 Session WebSocket 的四条并发握手回归，受控 TaskRuntime 端口使用同一个实际数据库准入池和不同 owner key，原代码必须复现无 welcome，修改后四条原握手全部完成。修复后用原真实连接的 hello 紧随事件和普通命令回执确认原事件持久化顺序保持，原已封项目不能出生，关闭仍等待在途 hello。原 callback / guard 断线、错误令牌、旧连接、取消、原回复及原 ACK 的已有回归保持。若命令／事件实际并发验证另出现阻塞，以该原失败单独设计修复，不用仅源码猜测扩大本片。

有限独立设计／实现审阅后，针对改变的候选做唯一一次完整本机 check，使用已核验的专用非生产 PostgreSQL，保留与已提交 CI 一致的 max_prepared_transactions=10；目标回归使用原 55335 实例。精确自有文件提交、六项 exact-SHA hosted CI、本机八组件部署分别取证。部署后续接新 r3 的实际任务，原事件／原数值页到 EOF，四类 Token、人民币验收估值、项目和系统两级／Agent／算力／泳道逐项对账。原失败日志与旧 r2 unbound 资源保留；本修复不能代签项目路由创建、旧资源清理、完整 100K／10M 规模或 AW 托管联合验收。

## 本片实现候选和真实回归

2026-10-07 10:47:50 UTC，原非生产 PostgreSQL 55335 的目标回归共 5 pass、0 fail、43 个断言。四条并发原 WebSocket 都收到真实 welcome，四份 connection birth 持久存在；四条 ready 回调又取得各自 TaskRuntime 原准入并完成，证明没有继承已结束的 Session scope。原事件 seq=1 在普通命令回执完成时已持久可见。关闭期间的原认证回调由 shutdown 等待，随后不发 welcome、不派发 ready，没有有效连接或未退出 birth。原 guard 断线、callback 私有 finally、排他 seal 等待期间的原 UOW 三项真实数据库回归保持通过。

原两项红色复现及清理诊断均保留。Bun 1.3 的 force-stop Promise 在拒绝 hello 并已关闭客户端后仍未返回；新增 fixture 已采用原 sessionDeletionFixture 的顺序：立即调用 stop(true)，再等待实际 Session 回调和数据库清理。未延长 10 秒内部预算或 25 秒测试预算，也未变更部署的池大小或 60 秒保护。

实现仅调整 runnerLifetime 的准入位置并增加关闭期间的 birth 保护；原 welcome-after-birth、完整 hello/shutdown、原退出私有许可和命令／事件顺序保留。完整本机 check、exact-SHA hosted CI、本机部署以及新 r3 原生事件／Token／人民币到 EOF 的核对仍待交付，不把目标测试通过记为实际任务用量验收或 RFC 完工。

## 原出生后 guard 断开的私有收尾补充

有限实现审阅 SOURCE7 v1 为 VALID/FAIL、P2=1；失败事实保留：独立 birth UOW 已提交后，外层准入连接仍可能断开，原实现直到外层成功才保存私有退出许可，导致实际 birth 无法退出。新增两项原 PostgreSQL / 原 runnerHub 回归先在修复前复现：birth 已返回但 guard 未完成时留下未退出记录；birth 实际提交、原回调尚在收尾时却提前关闭连接。

实现现在在实际 birth Promise 成功时立即保留原出生和私有退出许可。外层准入拒绝时，等待已发起 birth 的实际结算，再把原异常交给既有 runnerHub 的 finish；没有合成退出记录、替代身份或放宽时间预算。登记 helper 从 runnerLifetime 中提取，既有函数 80 行标准保持，两个自有代码文件的 ESLint 已通过。

2026-10-07 11:21:25 UTC，同一个原非生产 PostgreSQL 55335 的目标回归共 7 pass、0 fail、65 个断言。两次真实 pg_terminate_backend 各只作用于测试隔离库的原 guard backend；握手不发 welcome、不派发 ready，原 birth 的 exited_at 与 exit_digest 在真实私有收尾后写入，没有剩余有效连接；在途 birth 尚未结束时连接仍由原回调持有。之前的五项真实回归保持通过。完整 check、独立实现复审、远端提交/CI、部署、原 r3 原生用量 EOF 与 100K/10M 规模仍是开放出口，不能由目标回归替代。

## 完整检查揭示的待握手停机回归

2026-10-07 12:14:54 UTC，原等价完整检查自然结束，6460 pass、158 环境 skip、2 fail、1 error、438045 断言、6620 用例、1312 文件。两处失败分别是统计夹具的默认 5000ms 超时，以及原 runnerLifetime 停机断言退出应为两份、实际只有一份；该完整检查仍为 FAIL，不能由先前有限源码审阅或目标回归替代。

后一项已保留原测试不变，并新增真实 PostgreSQL / 原 Session WebSocket 回归：已有连接与已进入原 TaskRuntime 回调的再次握手在停机时，仍须保存两份真实出生及私有退出，关闭全部有效连接，后一个不发 welcome、不派发 ready。2026-10-07 12:22:18 UTC，修复前两个实际用例均复现一份应为两份的记录缺失，0 pass、2 fail、7 个断言；早先新增 fixture 的列名诊断不计作这个故障证明。

实现保持外层 open 拒绝停机之后新来的 hello，让停机之前已受理的原回调完成 birth 登记，再由登记后的 stopping 检查交给既有私有 finish 退出。原 Session guard 仍只包 birth，外层 driver 拒绝时仍等待实际 issued birth 结算。没有创建虚构出生／退出或延长期限，原项目删除准入保持。

2026-10-07 12:28:51 UTC，同一个原非生产 PostgreSQL 55335 上，原生命周期、原私有 finally、原完整统计、原快照及新增子树回归共 26 pass、0 fail、32273 个断言。原停机用例、四条并发真实握手、认证中停机与两个真实 guard 断线用例完整保留。独立实现复审、下一轮唯一完整检查、exact-SHA CI、部署、r3 实际原生用量到 EOF 以及原 100K/10M 规模仍未关闭。
