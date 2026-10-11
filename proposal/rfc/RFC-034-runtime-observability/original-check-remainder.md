# RFC-034 原始完整检查剩余修复设计

2026-10-08 原始 `bun run check` full-v7 得到 6522 pass / 6 fail，失败与原日志保留，不豁免任何失败或延长原预算。物理删除相关三项由其当前开发者修复；本设计仅覆盖以下三个失败。

## 原文件 IO 的机械并发

`tools/dev-auth/devAuth.test.ts` 的原四根目录、Bun.Glob 模式和 onlyFiles 选项、完整人口、两个既有元数据条目、原判定表达式、路径顺序与两个最终断言全部保持。把逐文件串行读取改为按原扫描次序最多 32 个未完成读取的一批 `Promise.all`；每批完整处理后继续，尾批也处理。32 是 IO 并发窗口，不是读取人口限制。不得跳过 node_modules、路径、文件或错误，不跨批或跨执行缓存，读取错误仍直接拒绝，原 5000ms 预算保持。

## 原采集测试目录的实际隔离

`developmentNativeDriver.test.ts` 直接调用驱动时只给 managed.runDir，没有给 DriverLaunchContext.runDir；正式 cliDriver bridge 明确转交 managed.runDir。真实 Linux 检查容器中的 `/tmp/crewstation-agents` 为 root 创建的 0755，当前测试用户 501:20 不能写，导致尚未 spawn 就失败，取消案例等待真实 spawn 后超时。测试给 DriverLaunchContext.runDir 同一原 fixture 下的唯一运行目录。不得修改生产驱动或默认目录，不删除、更改共享目录所有权，不替换真实 journal/WAL。原 1 次 bootstrap、原命令、退出／取消、kill、native 数据库不存在、invalid-capture 和三张 journal 表零行断言及原 30000ms 预算全部保留。

## 验证

独立设计门通过后实施有限两文件修复。先在同一个原 primary 只读挂载、501:20、原依赖和数据库环境跑这两份原测试，记录完整人口／耗时／实际事件与退出码；不得通过过滤失败案例或放宽时限获得绿色。冻结当前所有候选，独立实现门通过、其他三项修复就绪后才启动一次新的原始 `bun run check`。同一候选不得重复完整检查追逐绿色，原 full-v7 失败永久保留。

## 2026-10-11 改变后的候选原完整检查结果

在事务内原生JSON读取复用源码／回归改变后，34文件候选只运行一次原始 `bun run check`，2026-10-11 06:33:00.898 UTC开始、07:06:18.945 UTC结束，正式退出0。结果为6586 pass、0 fail、153项原条件skip、453095 expect，6739项／1339文件；测试段1855.66s。原架构检查、lint、两项typecheck和完整test均沿原命令执行。全部34文件、所有生产／测试指纹、原HEAD b79253b2702c84e0bc017455a33248e23b608196检查前后相同。

原环境使用既有primary只读挂载和普通501:20，Bun 1.3.13、原PostgreSQL／GitLab及依赖保持。原5000／30000／60000ms预算、全部原用例与断言不变；没有并发重复完整门禁，没有过滤失败、提高超时或通过重跑同内容追逐绿色。153项跳过来自原环境能力条件，不能写成所有实机路径已覆盖；自身提交的六项hosted CI与正式部署／producer／页面还须核对。

full-v7及后继全部旧失败与不完整回执保持。完整日志SHA256为 `feae9460227cb87bf2cd2eb121a62a442da4d6c50449e31909af679884b16448`，完整结果回执SHA256为 `e22ae22083985b3232867ac1561516830e00dffb1161f8e24797baa451a74bce`，原回执位于本次会话 `/private/tmp/observability-cs-transaction-read-original-full-check-20261011-v199/`。本节只新增实际结果，不改写前述设计或旧失败。
