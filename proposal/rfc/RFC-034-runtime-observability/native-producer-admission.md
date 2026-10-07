# N6a 原生开发调用：配置与验收边界

本片接通明确验证配置里的 OpenCode headless 新执行，不表示默认生产采集或 RFC-034 全部完成。CLI、Claude Code、业务原生分页跨 AW、未知尾部的全部退出路径，以及原 100K/10M 规模资格继续按原计划验收。

## 安装配置

`CS_DEVELOPMENT_NATIVE_OBSERVATION_ADMISSIONS` 是安装环境变量，值为严格 JSON 数组。每项是完整的 `projectId`、`profileId`、`profileRevision`，对应真实项目、OpenCode 算力和已冻结修订；缺省或 `[]` 保持关闭。非法值、额外字段和重复元组报配置错误，不静默跳过。配置条目没有数量上限。

本机平台非机密配置由 `crewstation-system` 中的 `crewstation-env` ConfigMap 提供（`deploy/k8s/platform/10-config.yaml`），cs-api 和 cs-controller 从同一配置加载。部署本片的实际兼容镜像后，专用验证配置可在这个原安装配置中增加该变量，并使受理/API 与后台恢复进程读取同一版本；不修改仓库缺省配置。示意值只说明字段结构，必须换成实际验证资源：

```json
[{"projectId":"01900000-0000-7000-8000-000000000001","profileId":"01900000-0000-7000-8000-000000000002","profileRevision":2}]
```

示意 UUID 不是实际项目或算力注册证据。不能以配置命名或这个示例代替真实算力 ID/镜像摘要/修订/Runner 能力验收。生产默认配置仍未增加此变量。

选择只发生在实际新 AgentStart 受理时，规范化意图存入原 execution JSON。缺少新字段的旧执行保持原行为，重连不会重新选择；真正重新创建的执行有新身份并保留原选择、档位、工作区 lineage 和请求。只读查询不生成任务或费用。

新 Runner 只有在实际选中的数字布局、原 Task/Pod 归属、当前健康 journal 与真实分页读取口同时具备时公布 `developmentNativePagesV2=2`。旧镜像、未知 journal 或缺失能力继续等待，不发普通启动、不造完整零。原 Session 登记及派发前两次健康核对之后才取原修订材料和现签 MCP 凭据。

## 人民币费率

人民币费率继续在系统运行观测中的算力价格配置入口维护，四项分别为非缓存输入、缓存读取、缓存写入和输出的每百万 Token 单价，按算力修订、实际模型匹配、生效时间和已受理价格目录修订固定。价格与采集配置各有职责；启用采集不等于配置费率。

明确标记的验收费率继续使用原批准样例：输入 2、缓存读取 0.5、缓存写入 3、输出 8 元/百万 Token，仅用于验证，不代表供应商账单。未定价不当成 0，真实定价 0 保持 0；已知部分四桶和人民币金额照常显示并标记缺口。不得用当前价格重写历史执行。

## 报告与恢复

报告仍遍历所有原任务、调用、原页及记录到真实 EOF；配置绝不成为历史任务、调用或汇总人口的筛选器。页大小和后台单轮批次只限制一次传输/调度，不限制完整统计。

实际规范化配置在模块装配时冻结为显示元数据，选中项目显示 `validation-selected`；默认仍是 `production-disabled`，业务来源仍为 `available`。内部完整报告请求持久保存该元数据和配置摘要。选中的新请求使用 facts 版本 6，默认版本 5 不变；构建和进程恢复读取原请求，不能读取当前开关重写旧 reportId。正式页面使用 `native-pages/2`、`recorded-scope-metrics/5`，原 3/4 查询及旧响应保持可读。

逻辑终态不提供物理停止或真实结束时刻。原结束作业、数字 drain/EOF 与 TaskRuntime 实际清理分别核对；缺少原环境/绑定/尾部仍保留占用与缺口，只有原执行已实际 finished 才标 finalized，不能把一个结束记录或数字证据当成清理许可。

## 验收登记

本片新增回归覆盖配置完整遍历、原意图和 execution JSON、旧 Runner 与能力消失、派发材料/ACK恢复、真实 PG owner/ending/request 持久恢复、原 201/1001/2001 完整人口、已知四桶/人民币和旧 UI 缓存不变。源码、专用 PG、完整 check、精确 SHA CI、镜像/部署、真实模型和正式页面分别登记；测试夹具不是真实模型回执。本片文档初稿不宣称上述验收已经完成。

## 原收尾标记的持久化保护

结束请求固定原 `logicalEnding` 后，普通 AgentStart 完整更新仍只准推进诊断/事件 cursor，不能覆盖原逻辑状态、身份或 `finalized`。选中的原执行必须在 TaskRuntime 的真实 `native.state=finished` 之后，通过原 agentId/executionTaskId 与已固定逻辑结束行写入单向 `finalized=true`。缺少该持久 participant 的受理明确拒绝；环境缺失或仅 cleaning 继续保持 false。该更新不提供数字完整性、价格或物理清理许可，原 endedAt 与 ending 实际时刻不会由它生成。

新增真实 PostgreSQL 收尾回归使用原 AgentStart、原 ending request 和重建 lifecycle，覆盖缺失/未完成保持、完成写回及 sweep 移除、错误身份与旧快照不能回滚。测试里的 Environment/Session 仍是明确模拟的端口，不作为真实模型或真实资源清理验收。
