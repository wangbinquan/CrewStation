# RFC-041｜实施与验收记录

状态：In Progress。用户在 2026-10-15 明确批准正式实现、本机部署与真实模型验收。本文区分源码检查、带替身的分层回归、准确提交 CI 与真实部署；未完成的层级不视为通过。

2026-10-16 补充：`2bf5bd9e56a728a1d2fc66be83a79e45c9a0afa2` 的 [CI 38861981825](https://github.com/wangbinquan/CrewStation/actions/runs/38861981825) 九项全绿，后端 manifest `2d98fd65094cafb37b0225b6a097056aa49f48acfc1605387d263978dc741108` 已部署七组件，Console/Runner 未变；24 次并发读取均 200（最大 3961ms）。正式页面 390px 无横向溢出，消息区 372px，浅绿色回答气泡 RGB(234,246,239)；嵌套确认 Esc 只关上层、历史关闭焦点返回入口。实机继续发现广播异步权限检查晚于外层返回，导致复用 backend 提前退出、回调出生被 SQL 拒绝。`asyncAdmissionLifetime.test.ts` 真实 PG 先红复现，然后修复为已发出的子回调保留 backend，外层返回后自身授权仍立即失效；两批共九文件 36 项/287 断言通过，精确 lint 和后端类型通过。新候选准确 CI/部署和换 Pod 冷续接仍需完成，原失败不覆盖。

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
| 准确 SHA GitHub gate/e2e | `3fb767e61c1e6878af01ae81efadbb6ab6e1bc6c` 的 [CI 38855659848](https://github.com/wangbinquan/CrewStation/actions/runs/38855659848) 九项全部成功；该源码八组件已部署，修复下述实机并发断点后的新提交须重新取准确 CI |

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

## 正式部署与实机阶段记录（尚未收口）

`3fb767e6` 通过准确 CI 后，以 `git archive` 构建并部署后端、Console、Runner。后端 manifest `7bb49c8178f5ff49649b528b477611ff42ba5db05021a565b237d99d2c5e2d06`，Console `0c4c10d0fed50adc35b2994b2fcf2b444b7c25df620c8a16065951e2b5604111`，Runner `0f87aceb9eb8c51ac3dd97bc4460e4d5b101aa6482b1d7f0bd41c590a3254e79`；两条 Bot 迁移成功，八个 Deployment Ready 1。

默认 OpenCode/DeepSeek 档位仅更新镜像至 r16，首次探针因本机 10 核 CPU 请求额度耗尽而超时；下线本次新项目的待命模板版本，释放从未启动的空父容器，并仅将该项目开发 TaskProfile 设为既有 100m CPU/2Gi/2Gi 模板后重新打开。未修改平台默认资源规格或其他项目。手动探针 `01a1433e-8ccb-7000-93a6-62b2575ec94e` passed；真实模型、resume、MCP、nativeConfig 成功，独立的可选 materialObjects 能力失败仍保持不可用，不能将整体 passed 写成全部能力通过。

隔离项目 `01a1432d-f9d3-7000-8fc6-c5abd3b64781`，父 task `01a1433e-acbc-7000-a4b8-3dd5484dd297`，conversation `01a14340-df08-7000-81c0-e4fba486bbed`。实际三轮沿用 Agent `01a14340-ef15-7000-9b74-113d12b79b70` 与 OpenCode `ses_ebcbec57fffecKX95xBPqYqrZR`，后两轮未再次提供随机标记，模型准确复述。第三轮同键提交两次，仍只有三条消息、一项执行和一次该轮原生输入。Chrome 切换与刷新保留草稿。

实际 `sleep 120` 子进程运行时通过 Chrome 点击“停止本轮”；OpenCode JSON 在工具完成前未输出 tool-start，停止时机使用 Pod 内真实进程清单证明，不冒称捕获了实时工具事件。整 Pod `c992ed8e-fc65-4922-9520-a45334fe3a49` 退出，消费者准入关闭并留下 kubelet-terminated 证明；新 Pod `7a302124-72ba-4211-bf29-496d8e0ddf7e` 使用相同原生 session/PVC UID `897430a0-a723-4295-be96-a52b9a25f28d`，准确回忆原标记。之后从集群侧按 UID 正常删除第二个 Pod，平台再次留下精确停止证明并暂停，第三个 Pod 冷续接尚待继续。

独立 CLI 从正式界面创建并实际回答 `CLI_INDEPENDENT_OK`。工作区文件 API 拒绝绝对路径和 `../` 访问 Bot 私有目录，Git 未提交/未推送均为 0；父 Pod 不挂 Bot 卷。贪吃蛇旧 ended/live-only 提示在正式页面可见，未向旧 Agent 发送消息。原工具查看按钮以旧 prompt 作标题曾被自动审批误判，核对实际仅本地选择记录的处理后获准只读继续，无执行副作用。

随后并发页面读取稳定触发 502：四个外层开发准入占满专用池，又等待跨模块内层准入申请新连接。原始 `CONNECTION_CLOSED`、HTTP 502 和失败验收脚本结果保留；`nestedAdmission.test.ts` 的四请求真实 PG 屏障先红（starved），修复原 backend 的嵌套锁/授权生命周期后，持久层三文件 11 项/66 断言通过。此修复尚待新准确 CI、后端部署及继续验收，RFC 不标 Done。

继续核对 CB-09 时发现父环境重建会遗漏 `botVolume`。先红用例证明保存后变为 undefined；保留该字段后，重建、私有卷准入和资源投影三文件 25 项/177 断言通过，前后身份与后续释放台账均受保护。首次绿色尝试在尚未模拟新 Runner 握手时释放被正确拒绝；补齐实际生命周期后通过，原日志保留。后端类型与精确 lint 通过。

准入修复全量检查中两项 Runner/PTY 沙箱超时，正常本机权限对照为 2 项/11 断言通过；本机测试库的 prepared transactions 关闭仍触发旧环境失败，一次性 PostgreSQL 17.11 开启 CI 相同配置后的对应文件 18 项/135 断言通过，容器已移除。完整原日志继续保留，部署仍以新候选准确 SHA GitHub gate/e2e 成功为前提，不把定向环境对照冒称全量绿色。

该全量后半段 Docker 文件系统耗尽（原错误 `No space left on device` / `53100`），测试 PG 继而耗尽连接并退出，完整结果为 5034 pass / 177 skip / 503 fail，1079.73 秒；不能当作候选通过。仅回收已被新候选取代且未部署的 89869ef5 镜像、精确 ID 清单上的闲置非共享构建缓存，恢复约 3.8 GiB；原测试 PG 重启后 `select 1` 成功，平台 PG 同样响应。未删除项目卷或既有部署镜像。

`b11fd663` 的 [CI 38860984110](https://github.com/wangbinquan/CrewStation/actions/runs/38860984110) 模块分片 1 捕获内层 scope 合并父授权的问题，未部署这个候选。保留原失败及既有用例，在隔离 PG 先复现后修正为内层只授权自身 key；连接复用/原授权生命周期/重建/Bot 卷/发布准入七文件 22 项、162 断言通过，精确 lint 和类型通过。最终候选在正常权限和独立 PostgreSQL 17.11（prepared transactions 开启、测试 WAL 限额）重新完整检查中；该库与现有库隔离，结束后移除。
