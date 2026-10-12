# RFC-034 原未绑定执行的首次结束原因接续

本片修复原未绑定、未获启动许可的开发 Agent 清理接续，不扩展统计范围或数字终态协议。设计候选；源码、检查、CI、实际原资源停止各需独立验收。

## 原始故障与已发布边界

`fda6727d7ae3983689e857e79033f3b148fb4d9b` 的六项 CI 已全部通过，本机七个后端组件已按该源码部署，正常迁移 `dev_session/0019_prestart_development_ending.sql` 已执行；这没有使原 B 自动完成。2026-10-11T22:56:37Z 的只读原库查询仍确认 B `01a11899-d396-7000-9315-07742ab95009` 保留原 Pod UID `5e560268-cd02-49af-ae55-b58d88198896` 和原 Runner Secret UID，环境 releasing/native cleaning。原 owner binding=null、closeReason=error、unsupported=false；原 AgentStart ended 但 logicalEnding=false，原 ending 作业不存在；原消费者 admission closed、无启动许可，Session 数字缺失仍应为 unknown。

现 `prestart()` 把 `original.closeReason ?? cancelled` 传给 `requestDevelopmentEnding()`。原 error 请求必须有绑定和真实数字终态回执，所以当前原 error/null-binding 分支返回 waiting，随后 inspectPrestart 拒绝尚无逻辑关闭位和 ending 作业的原行。普通作业自动重试无法跨过这个条件。

## 有限修复

只在 `prestart()` 已重新验证原 owner、Task selection、档位、非 terminal 的同一原 Pod/Agent、无 binding 且非 unsupported 后，调用原 `requestDevelopmentEnding(deps,id,cancelled)` 关闭尚未启动的准入。原 ending store 同一原事务使用 `original.closeReason ?? input.reason`，所以既有 error、completed 或其他首次原因保持；此请求不制造或替换逻辑 result、数字停止回执、数字 closure、Token 数字或 actualEndedAt。没有既有首次原因时继续保存 cancelled。

原 bound 出口、`requestDevelopmentEnding()` 和 `DevelopmentEndingRequestSchema` 均不变：completed/error 请求仍必须有真实匹配的 finished receipt。无 binding 的公开 error/completed 请求也仍等待，不能以本片绕过终态规则。此处 cancelled 是关闭未启动准入的请求，既有首次错误原因仍是独立原行事实。

随后仍按原次序重新读 owner/AgentStart/job，核对实际原消费者 closed/no-permit、真实 Session absent，才返回 stopping/unknown。Controller 的同一原 Pod 全部容器实际停止证明与 Dev completePrestart 闭合仍是释放前提；有启动许可、Session 存在、原 UID/身份冲突和读取失败继续等待。不能手动删除 Pod、修改原库或补造零用量。

## 实施与验证计划

生产仅修改 `modules/dev-session/application/development/cleanup.ts` 的 prestart 调用及解释注释。在原真实 PG `developmentPrestartCleanup.test.ts` 添加 error/completed 两个首次原因回归：先通过原 owner.close 保存原原因并让原 AgentStart 普通 ended；直接终态请求仍 waiting；通过 prestart 正常取消准入后保存原 firstReason、logicalEnding=true，原 finalized/endedAt/请求/价格/绑定保持，logicalResult/数字回执/closure/actualEndedAt 均为空，停止阶段 numericState=unknown，无模型发送或登记、迟到绑定拒绝，幂等接续不替换原结果。

先保留原实现红例，再改这一生产调用、运行同一目标的绿例与相关原回归。原断言、超时和环境跳过条件不修改。候选冻结后复核源码并只执行一次新候选完整检查；通过后精确提交、六项准确源码 CI 全绿后部署，再观察原 B 的正常清理和原额度恢复。当前 fda 的本地全绿和 CI 不能替代新候选检查。

补充实际跨 owner 回归：在原 `tests/e2e/developmentPrestartCleanup.test.ts` 追加一项原 error/null-binding/no-grant 链路，用同一真实 PG Dev/Session/Task/Resources 与原 Controller 构造链先保存原 error 和普通 ended，再调用正常 native worker，核对 firstReason=error、未制造数字流、停止证明前保留凭据和额度、实际 Controller 全容器证明后 closed/unknown、原 Session absent、原价格与结束时间不被替换、额度仅释放一次。复用原夹具，不修改它或任何原用例／预算。完整发布候选增加这一根 E2E 文件；不是以受控传输的测试证明本机 B 已停止。
