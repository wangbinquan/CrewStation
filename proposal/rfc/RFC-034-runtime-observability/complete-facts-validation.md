# RFC-034 完整执行事实与缓存升级验证

本片修复系统管理和项目观测的可见性：用量缺口不能让已完整核对的原 Task、执行次数、所属项目/受理算力名称、时间及泳道消失。严格 not-ready 数字仍未知；四桶 Token 和人民币不是零值，也不把有限采样/部分用量发布成完整统计。

只有原 Task source 到 EOF 且同 reserved repeatable-read snapshot 的 cohort 成功，才把原同 spool 的可保留 section 转为 strict facts、seal/stage/publish。发布及 status/page 都核原 manifest/receipt/row/count/摘要与双向父人口，数字 section 不进入 facts。页 reportId/snapshot/section/parent 与 cursor 不一致会撤下原报告，禁止继续显示旧汇总。原 ready 完整数字合同与名字/贡献/任务总量口径保持。

设计 sealed-execution-facts.md：DESIGN1 SHA 0a6b627d2e9677f70defdea73bea9698ffbdae1a9050224024040704778c24fc，独立 PASS 8b87602abbcc8e3e91b6bc232ac3a488a9fecf663224b941a65be267a10b9f11。SOURCE29 FAIL 两个 P2 保留；SOURCE31 v2 SHA acfa52455e5db11661daed9b5143e5ff0ffaf76d7486464dea82e63b247a792f，独立 PASS 4fb2531b39e19516c4c09439f60982cabb9dad57b7353f5b04bef8c74f0c15d6，31候选、16控制、22引用与清单共70目标首尾稳定。

原同 source identity/generation/revision/query/actor 的旧 not-ready 缓存无 facts，新 internal format discriminator 生成不同新 reportId；旧 report 不重写。该真实 PG 回归先红（新旧 reportId 相同），修复后1pass/12断言/38.71秒。两层来源列先红（错误称用量完整），修复后按真实 state 显示资格，完整25项 console回归/247断言/5.72秒通过。没有删原16测试和预算。

真实数据库原 owner fixture 的201 Task、1001 attempt、2001原 capture 分别在系统/项目全局和 Task lifetime报表分页到 EOF；新五场景和原合同/cache/spool合计16pass/0fail/4709断言/153.97秒。原两个一次60秒内串联独立完整构建造成 timeout 的v1/v2红记录保留；改成各自完整构建的独立case，原断言和60秒预算保持。quality root追加回归1pass237断言；strict fact row4pass56断言拒绝带数字字段的 not-ready行。

当前后端/console类型、精确30TS lint、arch59units4189源码通过。唯一当前完整本机门禁运行中，回执 /private/tmp/observability-cs-sealed-facts-full-gate-v1.json 只在自然终态后建立；未完成的命令不能记通过。以上201等为数据库回归人口，不是本机实际生产人口。

后续必须保留并追加：完整本机门禁、精确发布 SHA/六项 GitHub CI、八组件/实际imageID/节点OCI/241迁移checksum与原资源保持的部署、正式页面两范围/四桶CNY逐条原ID核对。当前已核本机部署427cc，不包含本片。SOURCE10页/持久ACK基础仍未装配实际native owner/producer；旧上限、原历史恢复、100K Task/10M usage、真实开发/业务/CLI用途及AW联合链路尚未完成。producer和删除入口保持OFF，两RFC In Progress。

## 完整门终态及数据库前提补验（2026-10-04）

前段“运行中”是META3 v1捕获时的历史状态；当前真实终态为完整门FAIL：5675 pass、144环境skip、1 fail、221354断言，5820 tests／1119文件。原31候选及16控制首尾一致，四层静态通过。唯一失败是未改动的 modules/data-control/tests/nativeProjectDeletion.test.ts 中“存在真实连接、预备事务或原名字锁就等待”用例；默认55432缺少预备事务，55000，不属于观测源码错误。正式CI module已有postgres17.11/max_prepared_transactions10设置。完整原FAIL保持，不改成PASS。

只读核对已授权既有55337专用实例prepared10，再运行原单项反例：1pass、0fail、5断言、0.843秒，17项仅因明确name filter未选；没有改断言/时限/skip政策。原测试SHA b5ba093a3a413e536eb83d35c9a61a0229ad339b487252e7a5687f2f676bcebc 与提交树一致，31观测源不变。前后原server system_identifier相同；30数据库和41角色全部原名字/OID保持。诊断工具首次错误import路径在连接前失败，修正为本仓原Bun resolver后只读核对成功；不是服务故障。

证据：/private/tmp/observability-cs-sealed-facts-full-gate-v1.json 与原.log；/private/tmp/observability-cs-native-target-v1.json 与原.log；/private/tmp/observability-cs-native-prerequisite-v1.json、after-v1.json。按开发规则§3对外范围环境红保留原失败、专项核对自身候选，接续新精确SHA六项CI；未重复未变化候选完整门。发布/部署正式验收仍待，不从源码PASS推断页面已修复。
