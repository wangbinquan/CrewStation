# 用量缺失时保留完整执行信息

RFC-034 的完整统计接口已取消统计总任务/总调用条数截断，但当前 `wiring.ts` 在全部原源到EOF之后发现任一用量缺口就返回not-ready；`reportService` 随后丢弃所有明细，页面仅显示状态卡片。这令用户无法看任何项目、Task、Agent和执行时间。原完整性守卫必须保留，不能用局部已知Token或人民币小计替代准确统计。

本次是已批准两级观测页面的可用性修正，同时适用于项目、系统和Task详情。AW已实现完整执行事实报告；本机实际全范围查询能完整读取425 Task／2869 attempt／14 accepted invocation，Token有原始缺口时仍是not-ready。该数字不作为CS实机结果；CS原会话凭据当前401，不能声称已验证CS实际页面。

## 原报告缓存内发布完整事实

原同一个数据库快照、source owner EOF、workspace、spool seal、有序页digest/精确count、原report owner CAS和project admission全部保持。全部原源及输出明细完整读取并核验后，若只是用量资格缺失，可另发布 `not-ready.facts`，仍使用原缓存及原持久页，不建立第二个报告/账本。building、原源读取中断、seal缺失、输出遗漏、代次变化和已删除范围不能返回事实。

合同为向后兼容的not-ready可选facts，包含header、summary和明确gaps。header新增 `coverage: complete-facts`，旧ready仍只接受 `complete`。facts summary的Token/金额metrics、trend和source metrics全部是not-ready，不允许ready数字或假零；Task总数、Task trend、原项目/算力/Agent名称、attempt数量和原时间事实可显示。只允许 `tasks/agents/agent-tasks/projects/profiles/profile-tasks/attempts/swimlane/quality` 明细；缺用量时不发布或请求模型分布、usage calls或native capture数值明细，也不把其未展示解释为零。每个被发布的行metrics严格换成not-ready，所有原行ID、名称、归属、Task/attempt完整计数、原时间/状态和非数值字段保持。

在原workspace中流式遍历原report rows及counts，生成事实专用namespace，不将人口装入JS数组。过滤只能排除上述非事实section，不过滤任何Task或attempt；各section/parent精确count由实际保留行形成。所有Task源回执保留且总数必须一致。原fileSpool seal/header/summary/digest发布在相同owner事务，cache终态为not-ready且携facts，原staging条数、最后digest、row/count双向相等、Task与sourceReceipt数量守卫保持。不存在新迁移或放宽原报告上传/删除屏障。

## 读取与页面

原status/page API返回封存事实，继续核对actor/project、原generation、snapshot与cursor绑定；not-ready没有facts仍不可读，事实报告请求非事实section必须明确拒绝。缺已发布行/页或项目/代次变化时不可沿旧事实继续展示。不能通过客户端在原not-ready之上假造header/count。

项目/系统各页和Task详情复用既有Stack/Card/RuntimeRows/Timeline/共享Dialog。not-ready状态说明保留，并在同页展示已封存的完整Task/Agent/项目/算力/耗时与Task柱状图；Token四桶及金额未知，原完整汇总仍不显示数字。缺口说明明确是用量缺失或尚未核验，而非零或正常等待任务结束；Task详情与原筛选、分页、返回/滚动/焦点继续可用。usage页仅显示算力归属事实；缺失模型/调用区显示明确原因，不请求被禁止明细。既有完整报告呈现和人民币保持。

## 检查

原完整统计/缓存/删除回归全部保留，新增合同拒绝facts数字/错误coverage、流式事实遮罩不丢Task/attempt/count/ID、真实PG原缓存封存/页EOF超过200 Task和1000attempt、反向counts/缺seal拒绝、事实section隔离、原代次/范围变化、页面not-ready仍能翻页/打开最后Task/泳道/Agent/项目算力、四桶未知/无数字小计/无人民币假零回归。事实页失败应撤下对应内容，不能保持过期成功。仍需确切提交CI、CS八组件本机部署和真实浏览器验收。

这项修正不能被称为历史缺失用量已补齐、正式native producer上限全部删除、真实模型计费/规模验收已完成，也不关闭两个RFC。完整原owner/before/reap/数字emission接线继续。
