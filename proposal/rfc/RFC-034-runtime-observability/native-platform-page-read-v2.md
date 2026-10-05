# 原生 v2 原页读取口接入平台统计来源

本片在已批准 RFC-034 原生 v2 完整采集范围内，补齐一个既有合同的组合入口。
Session 已在原数字页的首事件中持久保存原页文档、准备、准入与 ACK；已有
HTTP client 的 `readDevelopmentNativePage(key, passId, ordinal)` 可在普通 outbox
ACK 后继续从原 PG 读取。SessionModuleApi 和实际 Session root 尚未转交此方法；
平台 `developmentObservationSource` 也只提供 next、registration、resolve、
acknowledge。本片同时补齐进程内原 root 与统计消费者的组合链。

## 组合合同

SessionModuleApi 增加同一签名；Session wiring 直接读原 developmentUsage store，
不存在时沿用 `not_found`，原 key 冲突沿用原 store 错误。平台自有
`DevelopmentObservationSession` 端口增加原页读取签名，组合返回
`nativePage(key, passId, ordinal)`。生产装配仍传入既有 Session root API；不增加
第二份原生存储、数字账本、Pod RPC 或记录查询上限，也不重组原 document 字节。
Observability 自有 `DevelopmentUsageSource` 声明同一可选读取口，保留旧 v1 来源
与其装配。可选不代表 v2 能降级：未来 v2 消费缺少该口或原页时必须保持待核对，
不能用空页、零基线、SDK 数字或一次普通 ACK 代替原页证明。

该查询本身不写数字、不确认数字页、不改变 outbox 游标、不赋予新启动权限。
原 Session API 检查完整 key、passId、ordinal，返回严格原页证据；错误 key 或
不存在的原页沿用实际错误。消费者不能换取另一 key、另一轮或另一原生 generation。
已有平台对 v2 source-frame 的拒绝保留，因此本片不能激活 producer 或宣称平台已
投影 v2。父链分页引用、原 before/final 完整判定、唯一 ledger 数字投影和 CS→AW
v2 公共合同仍是后续组合项。

## 实际回归与交付边界

扩展已有真实 SQLite/WAL → FULL/WAL journal → Session PG → 严格 HTTP 回归：
完整 1,201 个原步骤通过实际 createSessionModule.api → 平台组合读取口得到
同一 document 与冻结 ACK，同时核对严格 HTTP client；逐桶总量
为输入721,801、缓存读8,407、缓存写15,613、输出6,005。普通 ACK 清空 outbox
以后再次读取仍得到原 PG 副本，未知原 rootCreatedAt 继续为 null。原失败事务、
丢 ACK、重启、错误 key、缺页、原哈希及 UTF-8 断言保留。该用例是实际数据库
和传输集成，不代表真实模型、部署页面或最终 Token 完整性验收。

设计与实现分别做有限独立功能检视。CS 仅执行一次有效完整本机门，确切提交后
核验 GitHub CI，再随已授权本机部署及真实任务验收继续。两个 RFC 均保持未完成。

## 2026-10-06 完整候选检查与懒加载测试同步

SOURCE2 的完整 check 已跑完：架构、lint、两组类型检查通过；6302 个用例中 6143 pass、157 按既有环境能力 skip、2 fail。五个原真实原生页复制回归均通过，原数量、四桶、UTF-8、PG 失败回滚与 ACK 断线/重启预算保持。两个失败均为原发布界面测试在 route/query 懒加载仍在显示“读取中”时立即找按钮或发布信息，原日志完整保留；不把该结果称为完整通过。

后继仅在这两个已有用例等待其实际维护入口或“发布 v0.9.0 正在进行”落地，沿用首个发布懒加载回归与共享 renderApp.click 的八拍调度预算；保留全部原断言、用例名、写入 oracle 和默认超时，没有增加固定等待时间、删断言、跳过或修改生产界面。两份测试文件此前与已提交源码相同，不涉及并行在制源码。新候选的有限检视、定向与完整 check、新确切 SHA CI、本机部署分别验收，平台数值 v2、producer 启用、真实规模和完整 RFC 仍开放。
