# 统计自动刷新保留原页面

RFC-034 的正式系统页面已复现：自动刷新返回 building 时，原完整报告被替换，统计卡片、趋势和明细卸载，内容滚动高度下降并重置位置。原 24,423 Token 和 ¥0.026922 在下一轮又恢复；数字没有消失，页面不应在生成下一快照时清空。

原 useRuntimeReport 继续按同一版本、项目或系统、筛选、任务和 pinned reportId 取实际 QueryClient 内容。新响应只有 building 时保留这一完整 queryKey 已接受的完整报告或完整事实报告；新 pending 身份独立保留，仍按原一秒频率轮询。新的 ready／带 facts 的 not-ready 原子替换 header、summary 和后续明细 reportId，旧数据不冒充新快照。failed／无 facts、首次 building 和新范围沿用实际状态，原页面撤销 facts 后下一轮不能恢复旧内容。

复用原 30 秒及回到前台刷新规则、原 recorded-scope-metrics/3、原主内容和统一组件。没有新卡片、横幅、按钮、CSV 或更多筛选。完整人口、原 EOF、Token 四桶、人民币金额和原服务器状态不改写。

原 hook 的新增回归先实际失败三项，日志保留；修复后 20 项定向页面测试通过。仅将同一个原 UUID 用 ProjectIdSchema.parse 标注类型后，与部分人民币估值候选一起执行 37 项实际测试，0 fail／1,977 断言，候选稳定。覆盖系统与项目、ready 与 complete-facts、实际一秒轮询、返回前台、缓存初始化、撤销 facts、滚动和焦点。此记录不代表全仓门、独立实现门、确切 SHA CI 或正式部署已通过，这些继续核对。

## 固定候选完整检查（2026-10-07）

实际 hook 与回归随部分 CNY、N3 scope 的同一候选完成一次完整 `bun run check`：6,327 pass／0 fail、157 原环境 skip，345,197 断言、1,288 文件。38 个候选与 11 个原控制字节首末稳定，原9项真实 QueryClient刷新回归及原任务 cache／sealed facts测试均保持。

新 scope、首次 loading、pending 1 秒轮询、日常30秒／focus、旧事实撤回与缓存能力均沿用本设计；旧内容不会被 loading 替换，也不会跨筛选保留或在当前事实撤回后复活。确切 SHA CI 和本机部署后还须在正式页面验证滚动及当前筛选稳定，当前不宣称已经部署。两个 RFC 继续。
