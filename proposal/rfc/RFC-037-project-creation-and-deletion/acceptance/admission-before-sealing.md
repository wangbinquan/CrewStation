# 原确认受理与封存修订

2026-10-07，原项目 01a0f30b-c652-7000-8d6f-553e3b5f6135，原完整22方计划 01a112dc-44f7-7000-87f0-57e94125515b，created 2026-10-06T20:16:27.455Z，digest 1264bf57b4b180fb8fea391414548b8fb6b2bc7dd2cf52c2454fc6086bdaba75。实际管理员二次确认输入 delete 后没有 operation，项目仍active；前端未知请求保持。实际Root只读对照网关4944→4956回调（新增12均finished）、发布2345→2370回调，完整来源仍complete且零blocker，但revision发生变化。此结果不是删除成功，也没有清理任何资源。

原件保留：/tmp/cs-rfc037-i36-original-project-second-confirm-v1.json、/tmp/cs-rfc037-i36-original-accepted-plan-v1.json（仅持久计划，不表示已受理）、/tmp/cs-rfc037-i36-original-plan-live-drift-v1.jsonl、/tmp/cs-rfc037-i36-original-plan-gateway-drift-v1.json。

修订边界见design I36-T13。83份逐项确认、全部原生独立BEFORE和外项目完整记录不改，不跳过来源或过滤回调。明确失败仅在当前同键查无操作时解除请求保留；未知错误继续原请求恢复。针对性红绿、完整门、确切SHA六CI、八组件部署和正式原项目独立AFTER待接续。

## 修复候选检查

新增故障回归先红：23 pass／7 fail，原日志 /tmp/cs-rfc037-i36-admission-red-v1.log 保留。首次绿色候选另发现新增夹具误写初始active和stop阶段，两个失败保持；将新增断言改为精确原状态、将原重新确认夹具设为真实seal，不放宽业务断言。最终八文件62 pass／0 fail、611断言，加原重新确认真实PG七项／56断言，合计69／0。专用非生产PG容器 d12386b3dccd7458ab86544934a982d03f82a6f8cbcd941f493a1c988d1d9c27 保持。

12个功能路径已冻结 /tmp/cs-rfc037-i36-admission-candidate-v1.json；精确lint、整仓两类typecheck和arch均通过，官方防护39／39、100%无违规（/tmp/cs-rfc037-i36-admission-patch-v2.json）。该变化候选仅启动一次完整check，静态四层已经通过，测试继续；不以定向或旧提交CI代替完整终态。独立源码核对确认实际 release/gateway 在共享准入内重读 project.assertProjectAvailable，project 的事务deleting关闭新回调，原在途回调仍需真实finally退出；编排循环全部22个seal齐全才进入stop，所有stop齐全才purge。完整物理scope、原native epoch、对象UID/内容和精确缓存选择仍绑定。

完整check在运行中已观察到四项失败，全部为 modules/observability/tests/projectDeletion.test.ts 在并行未提交native_revision列/迁移下的23502或42703，不涉及本批12功能路径；原错误与完整运行继续保留，不记完整PASS，不取消、不重启。依 development-rules §3 共享在制品规则，自有69／0、静态四层及39／39检查接精确17路径提交和干净提交树六CI；完整检查最终结果继续核实。/tmp/cs-rfc037-i36-admission-inprogress-audit-v1.json 已记录候选、完整原错误和三个外部迁移/表路径，不提交或回退其输出。

## 唯一完整检查终态

2026-10-06T21:37:01.549021Z 完整 check 以 exit 1 结束：6366 pass、157 skip、10 fail、437158断言、1299文件。12个候选功能路径及原专用PG身份全程未变，不重启完整门。十项失败均在 observability：七项 native_revision 列/原测试记录与并行迁移不一致，另有原覆盖根批量读取、原完整事实契约、覆盖根身份断言各一项。对应并行表、覆盖根存储、完整事实契约及两个未提交迁移保持原状并排除于本次提交。终态和精确原错误保存在 /tmp/cs-rfc037-i36-admission-full-v1.json、.log 及 cs-rfc037-i36-admission-full-terminal-audit-v1.json，不记完整通过。自有69／0、静态四层及39／39已通过；发布候选仍以 d736d8cb95b1aae34405573c4dd6ac776be48949 的干净提交树六CI为准。

## 精确发布与正式请求恢复

d736d8cb95b1aae34405573c4dd6ac776be48949 的 GitHub Actions 37532343194 六项终态全部 success，证据 /tmp/cs-rfc037-d736d8cb95b1-i36-admission-exact-ci-v1.json。正式八组件全部就绪；原存储探针、Runner和原生资源身份守卫通过，256份既有迁移未变、无新增迁移。部署证据 /tmp/cs-rfc037-d736d8cb95b1-i36-admission-v1-deployment-receipt.json。

实际 dev-admin 在 http://console.cs.localhost/admin/projects?q= 重新加载已部署页面，打开同一原项目的保留请求，点击“核对原删除请求”后收到明确“盘点已过期或已变化，请重新盘点后再确认。”，回到“删除项目前确认”，可重新盘点且继续删除不可用；没有手工清除浏览器键，也未创建其他删除操作。/tmp/cs-rfc037-i36-admission-deployed-recovery-v1.json、.png 为实际界面证据。随后通过该弹窗发起新的完整22方盘点；实际删除及独立AFTER仍待完成。

## 实际受理、原清单变化与只读导出事故

实际两层统一弹窗均展示原测试项目名称与标识，最终输入delete后受理原操作 01a11338-80af-7000-a710-9322722ebba4，确认计划 01a11337-a29b-7000-b2f2-4a8a0e179b12，22方全部complete、零阻断。Root真实project状态转为deleting；原操作取得7份seal回执后因 release-inventory-changed 进入needs-attention，未进入stop或purge。正式界面随后对同一操作发起“重新盘点并确认”，不创建第二删除操作。证据 cs-rfc037-i36-admission-first-confirm-v1.json、second-confirm-v1.json、actual-accepted-operation-v1.json 与 accepted-progress-v1.json（均/tmp前缀）。

一次额外只读证据导出错误地汇总该项目全部历史清单，2026-10-06T21:57:56Z 导致原PostgreSQL容器OOMKilled（exit137）。此查询已停止并改为精确单操作、固定元数据和计数；没有重写任何BEFORE或生产数据。原Pod UID e1c096f1-223a-4a78-a67c-d5b66345bcb0、PVC 1cefe909-de62-4307-b517-14aab56ac809、PV 93d700f2-130d-4517-a8be-f031ec9409a5 及全部原数据库/角色名字与OID均保持。容器CID由8f8233ab26bd…变为1706ad8312e1…，不能声称原容器实例未变。原操作恢复并保留；事故记录 /tmp/cs-rfc037-i36-admission-postgres-incident-v1.json。现有 nativePostgresSource.ts 原身份以Service UID、PG system_identifier、实际卷及目录来源为准，当前容器只作为每次采样的server见证；后续仍需完整实际物理与外项目数据AFTER，不能由本段替代。

## T14 实际阻断与修复候选

01a11341-e064-7000-88e8-b4319ed9d6e0 是同一原操作的重新确认计划，22方但complete=false、12阻断：data-control当前基线尚未重新确权，release/runtime-environment实际来源读取失败。调用read的accepted路径每5秒清掉该计划，导致实际清单无法查看；原计划及小规模阻断元数据保存在 cs-rfc037-i36-admission-reconfirmation-blockers-v1.json，未跳过。

在原API容器内额外加载完整Root的诊断于22:14:05Z触发OOMKilled（exit137），原API Pod UID 9b4f69ee-0721-4ba8-83da-4a8ad3c8781c未变，容器由3a778c865a36…变为bfe134c7282d…，现已Ready；该额外诊断已终止、未完成，不把它的无输出解释为来源通过。诊断终态 cs-rfc037-i36-reconfirmation-owner-errors-v1-terminal.json。后续使用正式服务的固定源码位置日志，禁止再次在在线容器构造第二整套Root。原操作、原BEFORE与所有资源守卫保持。

T14候选固定5个功能路径：自动读取只在同一operation、同一supersedes摘要、needs-attention/seal时保留完整或阻断计划；服务确认或阶段变化则失效。失败定位日志仅输出固定源码路径/行号，私密正文与日志异常均不影响完整来源阻断。实际先红：UI14／1，来源诊断真实PG11／1；最终5个实际文件48／0，加正确的provisioning/projectReconfirmation真实PG7／0，合计55／0、561断言。初次命令误写一条project目录的重新确认用例路径，Bun未运行它；已按实际5文件保留原结果并补跑正确7项，不夸大为六文件通过。

5路径精确lint、整仓两类typecheck和arch均通过；官方防护12／12、100%，无违规。该新候选的唯一完整check已经启动，冻结文件和原专用测试PG身份均固定；不取消或重复。55项、静态、防护、完整终态及精确提交CI均待作为同一候选的证据接续。修复未发布，实际项目仍停在seal。

当前唯一完整check已进入用例阶段且未取消；上一完整终态十项外部观测失败的七个实际在制品来源SHA256均与当前相同，未替换或提交。按development-rules §3，以本批55／0、四层静态及12／12接精确九路径发布；新完整检查继续保留到终态，不能把运行中记作通过。新审计 /tmp/cs-rfc037-i36-reconfirmation-inprogress-audit-v1.json 明确区分历史终态和当前已观察结果。
