# RFC-034 N6 原生分页驱动接线候选

本设计只解决实际受理 v2、实际驱动却发送 v1 的断点，沿用已批准的开发观测及 native-platform-consumer-v2 范围，不改变默认生产开关。原始失败及九帧留存，不能转换成 v2 原页或宣称原任务已通过。

## 原证据

CS3100a14d 八组件 Ready、六 CI success。原 r3 两 Agent/三个 Pod 的 UID 和 restart=0 保持，两个 Agent 已 awaiting-input。FULL/WAL admission header nativeSource.version=2，native preparations/passes/pages 均为空。Session 连续复制 A5/B4、Runner ACK5/4、平台 sourceACK0。九帧实际全为 v1，去重修订后五笔记录：23834输入、21568缓存读、0缓存写、203输出、总45605；验收专价诊断0.060076人民币。仅为私有原帧诊断，未进入账本，不是统计验收或完整树证明。

## 最小功能接缝

1. Supervisor 的不可变 v2 selection 进入 AgentSpec、ManagedAgent 的每轮最终 launch context 和包 DriverAgentSpec。只在同一原 accepted key / Pod / journal / incarnation 内创建 native owner closure；不把凭据或整个启动意图交给观测 reader。
2. Driver 的 v2 分支使用最终 spawn env 解析实际 OpenCode DB。旧 v1/default 路径保持；v2 不创建或持久 SDK/v1 capture，不能把原 legacy bounded reader 当新来源。
3. 每轮模型 spawn 前，由同一 upstream binary/arguments、cwd、最终 env 和降权 launcher 执行已实测支持的 opencode db SELECT 1 --format json，使 upstream 正常初始化自身 DB；不手工造 SQLite、root、步骤或零基线。已存在 DB 同样由真实 NativeObserver 观测。失败留下采集不可用，不自动调用/重启模型。不得记录 env/解密材料或任意数据库内容。
4. 原 journal 新增独立的本执行/本 turn checkpoint（仅本机 owner 接缝，不新增外部 Runner 指令）：完整原 key、Pod UID、turn/turnIndex、实际 observed store、观测时刻、当轮实际 resumeSessionId（可空），以及绑定的原受理 header 指纹。真实 FULL/WAL COMMIT 必须先于模型 spawn。第一轮 resume 必须等于原不可变初始意图；后继轮序号严格递增，其 resume 必须等于同执行上一轮实际持久 final 原页的根及已绑定原 root，不能由调用方自由选择别的 session。未知 root 的 fresh checkpoint不伪造 root；首个真实上游 session 只可绑定一次，同一实际 SQLite 中它必须是 parent=null 的根且其实际 birth 不早于原 checkpoint。绑定只能补 root，不改原观测时刻/文件/turn/初始 header。
   原 nativeOwner 的 baselineKind 改由该严格 checkpoint 的当轮 resume 推导，而不是把初始 header.resumeSessionId 用于每一轮；原 header 完全保留。已有只为初始轮创建 owner 的调用须继续受原初始意图约束，不能默认授予新当轮权力。原 owner admission、persist、interrupt 与 retained read 都核对同 checkpoint；readPage 返回该原当轮 baselineKind（已存旧页不改）。resume 在模型 spawn 前对该原 root 走 baseline pass 到真实 EOF并持久 COMMIT；首次 fresh 不能产生虚构 before 或把空旧数据冒充基线。
5. fork进程实际reap、stdout/stderr drain之后，检查原来源连续性，在同一原 root/turn 上走 final native pass至实际 EOF。每页只在原 journal原字节、parent/step/source与ACK同事务 COMMIT后释放reader页。actual model/发生时刻/四桶从原step读取。分页只限单次载荷，不限页数/整树/调用/任务人口。
6. 后续 interactive轮次使用真实当前 session作resume，先完整before，再本轮spawn，最后final；当前resident协议没有同等证明则不宣称支持。取消沿原 kill/reap/drain/末采集顺序；准备、来源变化、reader/owner/ACK失败留明确未知或中断，不能报告完整零或改写旧终态。
7. developmentNativePagesV2能力必须绑定真正可用的驱动producer接线及原健康journal/布局，不能仅因nativePage方法存在而公布。默认生产OFF；验证配置只在明确新镜像和新配置修订里验证。

## 原数据与验收

不热改/替换/recreate原Pod，不更改原受理选择或ACK。原九帧留在Session PG与原失败回执，旧r3原 v2完整资格继续FAIL。正向旧值恢复沿已独立 DESIGN v2 VALID/PASS 的 /private/tmp/observability-cs-original-v1-recovery-design-20261008-v2.md 与 exact7 SOURCE 候选进行：严格绑定原 key/registration/owner/原价，保留选择2但逐个 v1 capture sourceVerified=false；原修订和原计量键去重，COMMIT与原价估值后才 source ACK。后继 missing-owner 查询包含 finalized=false 的相同原 task/root/record；已有未完整旧数值必须 held，严格 adoption 条件完整保留；缺失 meter/model不能被视为 absence。真实 PG 九帧回归已1pass/0fail/62assertions验证四桶、原价、重启/失ACK/未来价格、后继相同步骤 zero additional以及 meter缺失拒绝；SOURCE/全门/CI/部署/原任务验收尚待完成。本片新 producer 不得假装旧 r3 有 v2 原页，不得以当前价格改写历史。

测试先覆盖真实native SQLite→真实journal→Session PG→平台 ledger 的全链与缺口，新增“初始 fresh→后继真正 resume”双轮、初始 resume、错 root/错 turn/逆序/replay/重启/旧页 retained-read 的真实 checkpoint 与前后链路；第二轮不能再被判 fresh或伪造空基线，再覆盖真正driver至producer装配，fresh/bootstrap/before持久先于实际spawn、resume顺序、自然退出/取消/失败、read-only原字节重送、超过旧步骤/深度/字节上限。旧模式的请求/SDK事件/原预算保持。独立设计和源码门、唯一新候选完整check、exact SHA六CI、新Task镜像(仅新执行)、本机部署、真实模型、项目/系统全EOF四桶+CNY对拍和正式页分别核对；不能复用以前6030/6327/6465等完整门代签新增候选。

## 仍待设计门确认

upstream DB初始化命令在实际最终launch版本的初始化与取消证据、before checkpoint/当轮严格 resume 合同、fresh root后绑定与保留原时刻、原 owner/read replay 校验、来源连续性和真实旧数值阻挡接缝。未通过这些实际条件前不改默认配置，不宣称完整或已修复。


## 实施候选与门禁（2026-10-08）

驱动接线采用本执行每轮 FULL/WAL checkpoint、真实 upstream DB 初始化、resume before EOF→spawn→reap/drain→final EOF；实际 native2选项透传至原 runtime/driver，原默认及旧 v1路径保持。能力发布同时要求实际驱动 producer2 和健康原日志。新增真实双轮 driver/WAL 与 Session PG/ledger/CNY 回归，包括初始 fresh、初始 resume、后续 resume、错root/order/time/key/source、缺前轮final、旧页ACK后重读，以及 bootstrap错误与取消。控制的进程输出与费率明确为验收专用，不代表真实模型或供应商账单。

原 v1九帧恢复 exact7 已通过独立 SOURCE和真实PG62断言，唯一完整检查6467pass/3fail/158skip，26个候选与控制首末保持；3个失败属于并行进程快照测试，不在本次观测7路径内，未收编其WIP或宣称整门通过。新接线尚待候选定向检查、源码审查、完整检查、精确提交CI和部署；旧r3不凭本改动变为v2完整资格，新镜像只验证新执行。


### 实际定向回归结果

2026-10-08 定向源码 lint/typecheck通过。驱动/能力/日志配置13项、222断言通过（`/private/tmp/observability-cs-native-producer-targeted-20261008-v3`）；真实 Session PostgreSQL/ledger/CNY双轮2项、168断言通过（v4），所有实际候选首末保持。fresh→resume两轮的新调用输入25、缓存读10、缓存写14、输出32，原价估值0.0001755与0.0001775人民币（验收费率，不代表供应商账单）。已有会话含一条无历史owner步骤的受理测试保留该原页和明确held，不能凭当前执行补造历史归属；两轮新调用仍只计一次。

回归曾定位到当轮checkpoint用schema解析后的字段顺序重算原页指纹，导致实际final EOF被误拒；实现已按持久原页body核对payload/cumulative digest，原schema/identity/ACK/EOF/数值和水位校验保留。新增取消测试确认upstream bootstrap被kill/reap/drain后保持cancelled，nonzero退出不启动模型，均不创建虚构页或零用量。缺日志目录、binary lookup、mock新增raw-root-parent以及Session复制前过早ACK均仅在新增fixture修正；全部旧断言和预算保持。源码审查、唯一新完整gate、精确SHA CI、部署和新真实模型仍待完成。


## 完整检查的结构修正（2026-10-08）

首次组合候选的完整检查在 `arch:check` 即终止，尚未执行测试：Agent 目录新增检查点后直接源码文件为 21 个，超过原 20 个规则；检查点类型依赖原 journal，而 journal 依赖检查点，形成类型文件环。原 FAIL 日志与回执保留，不记作完整通过。

检查点移至既有 `agents/development/nativeTurnCheckpoints.ts` 分组；原 `DevelopmentNativeJournalBinding` 与 `NativeAuthority` 的完全相同字段独立到该分组的纯类型文件，journal 在原入口继续重导出同一 binding 类型。两个执行类的可执行正文逐字保持，原 journal 表、事务、checkpoint/EOF/ACK、测试断言与预算不变。修正后按实际 37 路径候选重新冻结源码复核与唯一完整检查；旧完整检查不能代替修正候选的成功结果。

后继 SOURCE37 复核发现 journal 的原 `NativeAuthority` 返回类型仍需绑定；原 FAIL 回执保留。仅以原 binding.original 的 ReturnType 别名恢复原完全相同类型，并删除已无消费者的类型 import。执行正文、原公开 binding 入口与所有行为保持；重新冻结 v3 候选，不能复用 v2 FAIL 为通过。


## 2026-10-08 实际检查、发布与新模型验收

37 路径冻结 v3 已完成独立 SOURCE VALID/PASS，唯一完整检查为 6476 pass／0 fail／158 skip、450548 断言；实际候选与控制首末保持。提交 `aebbda4a1646bec16590098be1ef86eeff24ca8e` 已精确推送，[六项 CI 37692853218](https://github.com/wangbinquan/CrewStation/actions/runs/37692853218) 全部 success，本机八组件与实际 OCI 来源均已核对。

新固定 Task 镜像仅用于验证算力 r4。实际 fresh→resume 的同一原执行／root 已有三原 pass 真实 EOF、source ACK 3/3；四原 session／29 part／七数值 step 逐条对上项目及系统完整分页报表，四桶 21822／41856／0／243、63921 Token、验收人民币 ¥0.066516，旧四步不重计。原 r3 的已知 45605／¥0.060076 同时恢复可见，但原 v2 资格继续不完整。详见[真实验收及未关闭阻塞](./native-real-validation-20261008.md)。

新 B 未能调度；A 正常取消已有真实 WAL 终态与完整 ACK，平台 cleaning／Pod 释放仍未收敛；默认生产开关、CLI／算力测试与完整时间采集不凭此页开启。该实际成功不代签完整 RFC 或未启动任务。
