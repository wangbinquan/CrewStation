# 原生页持久回执与原根事实

原 SOURCE7 v2 的 P2／FAIL 保留。后继只在原续页测试 wrapper 转交真实 reader.rootCreatedAt，修复新增必填原事实的结构类型兼容；完整原断言、续页、重送、并发源更改和预算均保留，不将根时刻改为可选或以强转绕过。

本片延续已批准 native-reader-eof.md，补齐原 reader → owner 的逐页 ACK 传递。正式开发 producer 继续 OFF；本片没有实现 journal 的 page/source/ACK 同事务 owner，不把原 supervisor processed 或 void capture 当成已持久确认。

`nativeUsageOwner.ts` 的 reader 和 admit 保留同一原 SQLite read snapshot 的 rootCreatedAt。`nativeUsagePassStore.ts` 在原 BEGIN 中读取真实根行及已有 time_created 字段；旧数据库没有该字段、值缺失或格式不成立时保留 null，不用当前时间或后来的扫描补造。根时刻独立于原 session/part 单页载荷，全部旧数字和父索引持续遍历到真实 EOF。

`persistNativeUsagePass.ts` 先取得原 owner admission，再对每页的 actual binding、ordinal、cursor、scan position、累计计数、payload/cumulative digest 和原 source watermark逐项核对。只有原 owner 正式事务提交后的原 ACK 才释放 reader 当前页。失效 admission、读失败、持久失败、ACK 矛盾、reader ACK 或 close 失败都保留中断；中断写入也失败时保留两项错误，不能误记完成。

原 SQLite FULL/WAL 测试 owner 实际写入每个原页并返回对应 ACK，测试本身不充当正式 journal owner。三份原回归的本机针对性结果是23 pass、0 fail、79,821断言；包括12,001步骤、40,010非数字行、1,073 session与80层父链，全部旧断言和预算保持。同快照根创建时间在原文件被另一连接更改后仍保持91，后来的99不会替换原 admission 输入；缺根时刻保持null。

本片尚未提交、整仓门检视或正式部署。后续必须实现原 Pod UID／journalId／incarnation／accepted key绑定的 page、parent、step和数字source/ACK同事务 owner；prepare／实际spawn-reap-drain／完整before-final历史修订与completion；正式collector／projection接线；真实100K Task／10M usage和完整两RFC验收。当前已有页面的分类Token与人民币回执保留。
