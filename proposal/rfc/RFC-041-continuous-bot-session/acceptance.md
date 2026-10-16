# RFC-041｜实施与验收记录

状态：In Progress。用户在 2026-10-15 明确批准正式实现、本机部署与真实模型验收。本文区分源码检查、带替身的分层回归、准确提交 CI 与真实部署；未完成的层级不视为通过。

## 候选实现

基线 `a3cc357829faafd668a0881a2a176d8b8fb44828`。默认 Bot 按父开发 task 保持一个 conversationId；正常多轮沿用 Agent 与原生 session，停止后使用原生私有卷和原 sessionId 创建新的执行。CLI 与高级独立 Agent 保持独立。OpenCode 1.18.29 / 1.19.0 的会话数据库与会话数据可持久化，HOME、启动配置与凭据仍为执行临时数据；其他协议/版本不宣称支持这条恢复路径。

受理采用客户端稳定 requestId、服务端 revision 与持久 outbox；Runner 在调用模型前持久保存请求身份，结果未知只对账。私有上下文首次使用分配 1 GiB，通过真实 PVC UID、资源消费者启动许可与整 Pod 停止证明约束交接。项目封闭及永久删除清单包括三个 Bot 表和原生卷。没有旧上下文时明确失败，只有确认新的上下文才增加 epoch。

## 分层检查

本机原始命令输出保存在 ignored 的 `.local/cli-bot-acceptance/rfc041-*.log`，不能把这些本地文件的存在当作可携带的 CI 证明。

| 检查 | 结果与范围 |
|---|---|
| 结构、eslint、前后端类型 | `rfc041-static-third.log` 通过；补充用例后结构再次通过，精确 allowlist 的 101 个代码文件 lint 通过。随后共享目录的 `AdminBusinessRecoveryPage.tsx:28` 并行在制品触发整仓 lint，原日志 `rfc041-static-candidate-final.log` 保留，该文件不在本次提交清单。最终前后端类型分别在 `rfc041-backend-types-final.log`、`rfc041-console-types-final.log` 通过。新文件按层放置，无新架构例外 |
| 默认 Bot 与真实 PostgreSQL | `rfc041-conversations-initial.log`：5 pass / 0 fail / 38 断言；模型及 Runner 为明确替身 |
| 原生卷初始化与身份 | `rfc041-volume-tests-fixed.log`：2 pass / 0 fail / 10 断言；Mac 的测试 UID/GID 修正，最初失败仍保留 |
| 既有 Console 开发路径 | `rfc041-console-journey-initial.log`：22 pass / 0 fail / 135 断言；API 为组件测试夹具 |
| Bot 故障、严格 session 与持续界面 | `rfc041-fault-tests-fixed.log`：25 pass / 0 fail / 102 断言 |
| HTTP 与删除内容归属 | `rfc041-http-deletion-initial.log`：11 pass / 0 fail / 72 断言；包括保留执行关联但尚无 AgentStart 的封闭场景 |
| 真实 PG 卷消费者与停止证明 | `rfc041-bot-consumer-uuid-fixed.log`：1 pass / 0 fail / 13 断言；finished 状态及关闭准入不能代替精确 Pod/节点停止证明，UID 替换拒绝；物理 Pod 停止为显式证明夹具 |
| 现有资源保护与 Runner 协商 | `rfc041-bot-consumer-fixed.log` 对应 11 项通过；其中 Bot 存储夹具最初不是合法 UUID，修正后的结果在上一行，不抹掉原失败 |
| 固定运行镜像目录探针 | `rfc041-image-layout-probe.log`：镜像内 OpenCode 1.18.29 将 SQLite 建到指定 `OPENCODE_DB`；无模型调用，不构成冷续接证明 |
| 全量本地检查 | `rfc041-full-local-gate.log` 完整运行 1499.92 秒，5712 pass / 177 skip / 3 fail / 41220 断言，跨 1199 文件。失败为沙箱 PTY 回显超时、本机测试库关闭 prepared transactions、旧升级审计误将新增 Bot 表纳入旧表指纹而生成 `IN ()`。本次全量未通过，原日志不覆盖；前两项环境对照如下，第三项补充明确新表前后断言后定向验证通过。全量开始后只新增了监督器/设置草稿用例及修改升级审计，生产候选内容保持一致，没有重复启动全量门禁 |
| 失败的本机环境对照 | 正常本机权限下 PTY 定向检查 1 pass / 0 fail / 6 断言（`rfc041-terminal-outside-sandbox.log`）；独立 PostgreSQL 17.11 设置 `max_prepared_transactions=10` 后对应文件 18 pass / 0 fail / 135 断言（`rfc041-prepared-transactions-isolated.log`），不修改现有测试库配置、不覆盖全量原失败 |
| Runner 重启与设置草稿补充 | `rfc041-supervisor-options-final.log`：7 pass / 0 fail / 41 断言；真实 SQLite 回执跨监督器重建不重复派发、未挂载/错误 epoch 拒绝、设置关闭和刷新保留并在首条发送固定 |
| 历史升级审计修正 | `rfc041-upgrade-regression-fixed.log`：2 pass / 0 fail / 27 断言；升级前逐表证明三个 Bot 表不存在，升级后证明新表创建且为空，同时保留逐行旧数据指纹检查；原封闭回归一并通过，精确 lint 通过 |
| 准确 SHA GitHub gate/e2e | 待提交并等待终态；部署前必须确认同一来源提交 |

## 实机验收清单

| 编号 | 当前证据 | 仍需补齐 |
|---|---|---|
| CB-01 | 实际 PostgreSQL 的稳定对话和同一执行多轮回归 | 隔离项目真实模型三轮、原始事件和 sessionId |
| CB-02 | Console 草稿、历史、CLI/Bot 模式用例 | 部署后 Chrome 刷新、离开/返回及独立 CLI |
| CB-03 | 控制意图、晚到事件、停止证明及严格 session 回归 | 真实执行中停止、完整物理停止及随机标记回忆 |
| CB-04 | 目录校验和固定 UID、同 epoch 恢复回归 | 真实新 Pod 身份与相同原生 session、无双写证据 |
| CB-05 | 重复 requestId、revision 并发、持久回执未知状态回归 | 实机同键重试和只有一个执行的对照 |
| CB-06 | 缺失/损坏原生数据、不同 session 拒绝；显式 fresh 用例 | 实机 fresh 边界与旧历史保留 |
| CB-07 | 旧独立 Agent 不合并，live-only 与不可恢复提示用例 | 正式页面检查贪吃蛇现存旧历史；不终止其活跃旧 Agent |
| CB-08 | 统一 Dialog、嵌套 Esc、返回焦点/滚动用例；原型桌面/390px 检查 | 正式界面的桌面与 390px 截图/尺寸 |
| CB-09 | 私有挂载与父生命周期投影、删除清单及准入回归 | 真实卷台账、工作区隔离、父保留/回收事实 |
| CB-10 | 各分层结果如上 | 候选 SHA CI、镜像来源、实际部署/Ready 与模型/浏览器事实 |

旧版本已经删除 HOME 的贪吃蛇 cancelled Agent 不具备可恢复原生数据。本实现不会通过复制聊天记录来宣称它已恢复。既有工具详情、浅绿色回答气泡与发布的贪吃蛇继续保留。
