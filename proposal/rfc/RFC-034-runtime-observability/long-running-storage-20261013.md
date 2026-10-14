# RFC-034 长稳存储补正（2026-10-13）

用户已批准 AW / CS 同步补齐长稳缺口、完整保留统计事实、不设任务或调用总量限制，全部实现和用例写完后集中验证，再提交远端并部署 CS。本文件补充既有 RFC，不创建替代统计口径。

## 不变量与数据生命周期

1. 原始用量、原生采集证据、计价依据和审计事实不受自动回收影响；小时/日汇总以及当前贡献完整保留。分页、事务批量、维护时间片只控制一次工作量，所有任务最终遍历到 EOF。
2. 页面报告是可重建派生缓存。相同主体、权限范围、筛选和已发布版本复用同一报告；读取、分页和维护引用保护版本。普通报告闲置 7 天后可释放其派生行，活跃访问续期；这不改变任意历史日期的完整查询。过期链接明确恢复到同一筛选范围的新完整快照，不能把新旧分页混用。
3. 无租约的旧缓存先获得完整 7 天迁移宽限期。回收只有白名单派生表写权限；不得通过通用表名参数删除事实。报告、范围成员、历史版本必须按同一个提交的引用集合决定可回收性。
4. AW 历史保留当前版本、有效报告的最早版本及其后的变更，闭区间的旧成员与贡献才可回收。范围引用绑定报告，孤立范围可重建。维护中的原报告及其原版本不因闲置回收。
5. CS 对每个任务/role/key 保留当前版本和每个有效 report/maintenance 水位所需的历史锚点；可先采用最早水位加一个锚点的保守保留。缓存版本保留当前、报告引用、维护引用；准备中的源工作不得被误删。全部读取/发布与回收使用已有数据库事务和报告准入锁。
6. 回收分小事务、可中断、可重放；确认完成的派生源通知可归并，但原始事件、证据、价格审计不删。失败保留工作和错误，成功提交后才推进恢复游标。

## 容量与运行状态

管理端显示数据库/统计表及索引占用、可复用空间（引擎支持时）、事实与派生数据占比、增长率、最近回收结果、积压和最旧等待时间。只在真正获得承载数据库的卷容量后计算剩余天数；远程数据库不能拿应用宿主空闲磁盘冒充数据库空间，未知显示未采集。

容量采样按小时覆盖写入；历史以日汇总保留，不随页面刷新制造样本。容量压力和投影积压进入已有异常呈现，不替换任何已知 Token / CNY 数字。磁盘/数据库失败不得 ACK 未落盘事实、清空队列或显示完整；恢复后沿原持久身份重放去重。可扩容的存储及备份是无限新增事实的必要运行条件，系统不能用删除事实模拟无限容量。

## 实施与验证清单

- [ ] 两套迁移、共享快照复用、引用保护、报告续期、派生历史回收和后台接线。
- [ ] 容量采样、增长率、积压/回收状态的管理 API 和正式页面，中英文与公共组件。
- [ ] 升级宽限期、无变更反复查询存储稳定、超过多批数据完整回收、活跃游标/维护保护、回收失败回滚和恢复。
- [ ] 原事实逐条身份和四桶/CNY回收前后一致；新增、迟到、下修、模型补全和重新计价后仍完整。
- [ ] 注入写失败后不提前 ACK，重启重放无丢失和重复；真实数据库持续更新/查询混合场景记录行数、体积与延迟。
- [ ] 完成全部代码和用例后集中验证、独立功能检视；AW 以 hosted exact-SHA CI 为准，CS 一次最终完整本机 gate、六项 hosted CI 后部署与页面验收。

当前状态：全部生产接线与本轮测试用例已经写完，进入集中验证；以上勾选只在对应验证有确切结果后更新。原失败、规模 CI 取消和未完成验收均保留。

## 设计门 R1 闭合补充

- AW 水位为 7 时必须保留版本 3 写入、12 结束的 `[3,12)` 历史行及 membership。仅删除 `toRevision` 非空、`toRevision <= 最早受保护水位` 且无独立引用的闭合区间；CS 每键锚点包含 `document=NULL` 删除标记。较新版本和当前行不受回收影响。
- AW 报告选择/登记/续期/退役共用数据库事务级 lifecycle advisory lock；登记时复核目标版本仍存在，已回收便在锁内改选当前完整版本，再计算请求键。GC 同锁原子重核到期和维护引用，将租约改为 `retiring`、释放可复用请求键后提交，再分批释放派生行。新请求生成新随机报告 ID；旧 ID 永不复活。范围成员登记也在该协议下，并持久关联引用它的报告。
- CS 回收取得已有报告准入的独占锁，正常读取/发布持共享锁。GC 同事务更新独立 lifecycle guard 代次；固定报告 REPEATABLE READ 在登记引用前锁读此 guard，若其快照跨过回收提交则发生可重试的序列化冲突，重新整笔选快照，不保留旧快照中的幽灵行。租约续期与退役共用准入锁，退役后不能续期；引用删除分包，当前任务及正在执行的维护水位和删除锚点继续受保护。
- 回收退役的是可重建报告缓存；页面遇到过期报告明确回到原筛选建立新报告，并清除旧分页游标。旧错误与新快照不能混合，既有事实与费用始终不删。
- CS 提交通知归并采用同一事务 `DELETE RETURNING` 的确切行数增加持久 clock；保留总 revision 恒等，不使用 `MAX(sequence)` 代替已提交人口，迟交事务仍计入。

## 实现记录（验证前候选）

- AW 使用独立 `observation_work_retention` 表记录准备工作水位和等待时间，兼容已部署迁移，不改写已发布表结构。投影水位只读取统计头，维护排序编号不参与保留判断。
- CS 的报告任务快照按数据库 JSONB 的规范字节计算 SHA-256，共享不可变文档；报告只保存引用。摘要碰撞写入由数据库不可变约束拒绝，原报告内容完整性验证继续使用既有语义摘要。
- 两套独立维护 worker 失败即记录错误与异常，数据库不可写时保留源队列并等待恢复；采样每小时一次、一天一行。异常历史只写状态变化，避免稳定异常每分钟制造重复历史。
- 新增真实数据库用例覆盖超过多个处理批次的人口、原始事实逐项保留、续期与退役交错、CS 序列化快照重选、迟交提交通知、迁移宽限、回滚恢复及页面过期链接恢复。处理批次不是任务/调用总数限制。

- 2026-10-14 R28：原完整检查 R13 为 6,756 pass / 177 原条件 skip / 1 个原 201 Task、1,001 记录升级用例在 60 秒内超时，并保留其清理后的异步异常。原规模隔离诊断完成 41.58 秒，其中 6,043 次临时工作区第一页查询累计相邻查询间隔约 7.52 秒；这是诊断分组而非精确 SQL 服务时间，不能替代完整检查。新实现由刚创建 TEMP 表的原单一 snapshot owner 记录已写 namespace，对从未写入的 namespace 直接给出真实空 EOF；256 个 namespace 只作为内存加速账本，填满后全面回退 PostgreSQL，不限制 Task、调用、分页、写入或读取。默认独立 workspace reader 始终读 PostgreSQL，写入开始即登记避免并发插入被漏读，所有 active/abort/size 检查照常执行。新增真实 PG 空页、随后写入、跨账本边界、默认独立 reader 与原错误检查，原 10,001 行 EOF、201/1,001 用例与预算不变。
- CS 历史版本回收从“最早保护点以上全保留”改为逐行 [sequence, nextSequence) 的实际水位保护；保留当前 cache、完整 report task view、pending maintenance 的各自前驱，包括 NULL 删除锚点，保留最新行和待办 Task work。下一版本通过原 (task_id,role,key,sequence) 索引查询，原 500 行游标只控制调度。新增 601 key × 5 版本、超过一批的旧报告/独立维护水位/当前水位、任意精度 numeric、NULL 锚点、原始使用四桶及 CNY 逐行不变回归。原表 allowlist、所有原始 usage/valuation/capture/price/audit 表与已有删除生命周期锁不变；旧报告实际锚点保留，但不再钉住中间无引用版本。候选先存为有限私有文本检视材料，未执行 SQL，未编辑 CS 主仓。

- R30 follows the retained R28 SOURCE failure: the temporary query counter delegates only when the original postgres debug value is a function, preserving valid boolean debug settings, all original population/EOF/budget assertions and the finally restore. No SQL or production database operation has been executed by this source preparation.

- R32 retains the original R14 static failure: arch/lint passed, TypeScript rejected three unqualified workspace.get generic assertions and two empty-list assertions on postgres RowList metadata. No functional test was entered. The successor specifies the original document shapes and compares all complete view rows as a plain list; no field, numerical assertion, Task/record population, SQL, production code or budget changes. R13 remains a real timeout, R14 remains a static failure; the unchanged production SOURCE approval is reused with this targeted test typing delta.

- R55 retains the original R15 full-check result: 6,758 pass / 177 original-condition skip / 2 new lifecycle failures, both PostgreSQL 42P18 on an untyped parameter inside jsonb_build_object. All three watermark JSON writes now explicitly bind text, retaining exact decimal values above 2^53 and every original four-bucket/CNY, EOF, watermark, population and timeout assertion. The earlier full-report upgrade timeout passed in this run within its unchanged 60-second budget (36.95 seconds); R13/R14/R15 failures remain failures. Production files are unchanged from the R32 reviewed candidate.
