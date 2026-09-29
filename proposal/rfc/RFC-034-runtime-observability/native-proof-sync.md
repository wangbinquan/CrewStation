# RFC-034 托管原生证明同步 v2

沿用已批准 RFC-034 与 RFC-371 的兼容增量。跨仓完整设计见 AW `design/RFC-371-run-observability/native-proof-sync.md`（独立功能设计门 PASS）。AW 候选 f4d02c115 已推送并经独立静态功能复审 PASS；本 CS 服务端候选经独立静态功能门 PASS、定向及静态检查通过；单次完整候选门禁于 2026-09-29 03:00:12Z 结束，4197 pass／142 skip／0 fail（26633 断言、838 文件）。12 个代码/测试/夹具文件仍与冻结候选指纹相同，后续仅追加文档；精确发布、CI、本机部署及托管实际运行继续，不宣称完整 RFC 已完成。

同一业务观察 GET 路由仅在显式 Accept `application/vnd.crewstation.execution-observations.v2+json` 且质量非零时返回 v2，默认、通配和 q=0 均保持 v1；服务身份与项目归属检查相同，响应按 Accept 区分缓存。v2 复用原 usage/valuation 合同并增加独立 capture 摘要，严格核对信封、完整业务执行身份、来源、摘要 ID 与观测时间；内部开发身份不得外泄到业务观察。CS 与 AW 使用同一份原始 JSON 夹具逐值验证，旧 v1 明确拒绝 capture。

复用 usage_changes 和 native_capture_history 的同一任务序号。增量每种来源至多取 limit+1 后统一排序、总共只输出 limit 项，续页只推进到最后输出项；全部读完才推进任务 head，因此不会因数值密集而跳过证明。快照按固定 through 读取每种记录的最后版本，使用 capture/usage/valuation 前缀的稳定键合并排序。v2 snapshot ID 与 cursor 各带 v2 前缀，和旧格式互用返回客户端错误；旧 CS 拒绝新游标时由 AW 仅对已知 v2 续页恢复新快照。无需新表或迁移。

人民币估值、可见性与快照过期保持原规则，读取前后复核金额可见性修订；隐藏时 capture 数值摘要可见、金额始终去除。完整零消耗仅由 AW/CS 各自的真实完整证明与同步边界推导，capture 本身不加 Token、不提供替代单价。

验证包含原始合同反例、四种版本协商、仅证明 pending→complete、600 条数值夹杂证明与估值的多页读取、冻结快照期间晚到证明、跨版本续页、隐藏/开放费用、可见性竞争、过期、越界游标及内部开发身份拒绝。CS 真实 PG 定向与一轮冻结候选完整检查，AW 全部执行检查由 exact-SHA hosted CI 负责。取消 CSV、更多筛选和关注任务卡片的裁定保持不变。
