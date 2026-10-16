# RFC-041｜实施与验收记录

状态：Done · 2026-10-16。作者批准范围内的正式实现、本机部署、真实模型/Chrome 以及物理资源回收验收完成；完整本机检查的历史失败保留，准确 GitHub CI 与实机证据单独列明。

## 最终交付事实

CLI 与 Bot 保持独立。默认 Bot 按父开发 task 保持一个 conversationId；执行 Pod 更换与父环境保留工作区重建不创建新的聊天上下文。只有用户确认“开启全新上下文”才增加 epoch。回答继续位于浅绿色气泡内，工具记录独立展示完整参数并通过统一 Dialog 查看。

最终七后端源码为 `32cf2d7e154744412bcc11c951597049ec7b9463`，对应 [CI 38870965711](https://github.com/wangbinquan/CrewStation/actions/runs/38870965711)。Console 保持 `9b4aa5a3d1a2e04663d2547db7690c0b392ff717` 镜像，已由仅测试修正后的 `ff948919109062e3355d569699c71b53c779f7a7` 的 [CI 38868457866](https://github.com/wangbinquan/CrewStation/actions/runs/38868457866) 验证。9b→ff 的唯一差异为 `apps/console/src/tests/developmentModes.test.tsx`，生产文件逐项相同；32cf 补正旧执行被新一轮意图覆盖的历史状态，并依据真实 finished 环境只读修正已有错误标签。最后修正的真实 PG/HTTP 七项、65 断言及 lint/类型通过。全部镜像从准确提交的 `git archive` 构建，不包含共享目录内 RFC-040/042 在制品。

| 验收 | 实际证据与层级 |
|---|---|
| CB-01 | 隔离项目真实模型前三轮保持 conversation `01a14340-df08-7000-81c0-e4fba486bbed`、Agent `01a14340-ef15-7000-9b74-113d12b79b70`、OpenCode `ses_ebcbec57fffecKX95xBPqYqrZR`；后两轮没有再次提供随机标记，模型准确复述 |
| CB-02 | 正式 Chrome 刷新前后历史消息逐条一致，草稿一致；离开返回和 CLI/Bot 切换保留当前 Bot。独立 CLI 使用 `ses_ebcb7c27affe6UTi7lUPNAtLW4`，真实回答 `CLI_INDEPENDENT_OK`，未绑定 Bot session |
| CB-03 | Pod 内实际 `sleep 120` 运行时点击“停止本轮”；旧 Pod 全部容器终止并关闭准入，随后新 Pod 以同 session 回忆随机标记。原生 JSON 在命令完成前未输出 tool-start，停止时机由实际进程列表证明 |
| CB-04 | 集群侧退出第二个 Bot Pod 后，第三个 Pod UID `ef809070-0cee-40f0-9ed1-16c172615783` 从同一私有 PVC 冷续接；真实返回“冷续接成功：”及原标记。父环境重建后的新执行也以同 session 回忆原标记，旧执行均有精确停止证明 |
| CB-05 | 实机第三轮相同 requestId 重试，数据库只有三条用户消息与一项执行，重复回执仍指向同一 revision。丢回执、刷新保留请求身份、并发 revision 拒绝由真实 PG 和 Console 回归覆盖；不将这些夹具写成实机网络断流注入 |
| CB-06 | 实机确认新上下文后 epoch 从 1 变为 2，首次新消息取得不同 native session；旧回答仍在同一时间线。缺失/损坏原生数据及不同 session 回报以 Runner/驱动和模块故障用例验证，未破坏用户现有卷做模拟 |
| CB-07 | 正式 Chrome 核对贪吃蛇旧 ended 与 live-only 历史提示；不自动合并旧 Agent，不向既有活跃 Agent 发消息。旧版本 HOME 已删除的执行不宣称可恢复。既有贪吃蛇正式游戏页面仍可正常访问 |
| CB-08 | 正式桌面与 390px 无横向溢出；窄屏消息区 372px，回答背景 RGB(234,246,239)。统一历史/工具 Dialog，嵌套 Esc 只关顶层、关闭回到触发按钮；长历史末行由组件回归补充。实际 bash 命令、输入与结果在工具详情内，未混入回答正文 |
| CB-09 | Bot 私有 PVC UID `897430a0-a723-4295-be96-a52b9a25f28d` 独立于工作 PVC；父 Pod 不挂载它，文件 API 拒绝绝对路径与 `../`，工作树未提交/未推送均 0。父重建保留 task 与两卷 UID；释放 follow-container 父会话后按平台流程回收原两 PVC 及各自 PV，资源台账为 absent/stopped |
| CB-10 | 最终 CI、镜像来源/摘要、八组件实际 Ready、原生模型事件、PostgreSQL 回执、停止证明、物理卷回收与 Chrome 事实分别留证；详见机器可读记录，不以局部测试或原型代替部署验收 |

## 验证边界及过程失败

完整本机 `bun run check` 并非绿色。最后一次完整结果为 5720 pass / 176 skip / 3 fail / 3 errors，41279 断言、1201 文件、2019.06 秒；三个默认 5 秒超时分别在安装脚本、provisioning 删除工作器和 resource-access 多页删除。结束后正常权限仅对三文件对照为 24 pass / 0 fail / 365 断言，不替代原全量失败。完整运行使用当时 `2bf5bd9e` 生产候选，后续修复按内容范围验证及准确 SHA GitHub CI 验收；一次性测试 PG 已清除。

实机发现并补回归的断点包括：嵌套准入占满连接池造成 HTTP 502、嵌套授权不得借用父 scope、异步 WebSocket 权限回调提前失去 backend、父重建遗漏 botVolume、准备中被旧 paused 覆盖、父清理结束后卡在 stopping，以及已保存草稿离页误提示。对应失败原件保留，修复后通过真实 PG/组件回归；没有手动修改业务数据库状态来通过验收。

`b11fd663` 的 CI 38860984110 捕获嵌套授权错误，`9b4aa5a3` 的 CI 38867288941 捕获旧草稿断言；这两次失败均保留，不用重跑同一失败提交掩盖。`9b4aa5a3` 的其余模块、静态、e2e 成功，随后测试修正提交重新跑完整 CI。原 Docker 空间耗尽、PTY 沙箱、prepared transactions 与旧升级审计失败也保留在下方历史记录。

原生恢复只对已协商通过的 OpenCode 1.18.29/1.19.0 合同成立；不承诺无限上下文，不从显示的聊天记录伪造原生 session。`停止本轮` 与 `释放整个开发环境` 的生命周期不同：后者在 follow-container 模式下会回收原生上下文卷。默认档位真实探针的核心模型/resume/MCP/nativeConfig 成功，可选 materialObjects 失败仍保持不可用。


## 已验证部署与可携带证据

最终后端 manifest `sha256:d6c6a0b95bdc14dcdbbbdac0f6950edb670ca3d6857dc19a0272880c83437851`，Console manifest `sha256:a4276724b5ed47e4f2696bf6e5f85e9106d277378c808542f8560f3489f0bc27`，Runner 保持 `sha256:0f87aceb9eb8c51ac3dd97bc4460e4d5b101aa6482b1d7f0bd41c590a3254e79`。后端与 Console 对应两条准确 CI 均九项成功，八个 Deployment 实际 Ready。最终 24 次并发读取全部 200，最长 3792ms；会话服务观察日志没有原准入 warning。

原 epoch 1 四次执行保持 `ses_ebcbec57fffecKX95xBPqYqrZR`；父重建后的第四 Pod UID `b64685e8-fca4-42d7-b5db-e13f44bb6b3e` 正确回忆标记。显式确认后的 epoch 2 使用 `ses_ebc465800ffe5MLqCuqxKu96pF`、第五 Pod UID `69f5fe6a-8518-4714-b623-7ad942281767`。新一轮没有自动合并 CLI 或旧独立 Agent。

2026-10-16 08:19 UTC，通过正常平台 API 释放本次验收父 task；其 Pod `7b34037f-fa67-4a06-8565-3bdd51f55d79`、两张原 PVC 及其 PV 均已消失，资源台账 absent/stopped，五个私有卷消费者均关闭准入并有精确 kubelet 停止证明。工作树未提交和未推送均 0。随后同项目重新打开独立开发环境 `01a143cd-35e6-7000-baa6-c960f6012fcb` 供界面查看，正式 Chrome 中新 Bot 已真实回复并处于等待输入状态；它不是对已回收原上下文的恢复。[打开正式页面](http://console.cs.localhost/projects/01a1432d-f9d3-7000-8fc6-c5abd3b64781/dev-session?view=guided)。

完整身份、回执、筛选后的原生事件、停止证明、卷回收、浏览器事实及原始本地验收记录的摘要见 [可携带实机记录](continuous-bot-live-20261016.json)。该附件不含认证 Cookie、Secret 或模型密钥。本机完整原日志仍位于 ignored 的 `.local/cli-bot-acceptance/`，文件存在和摘要不冒充可独立下载的 CI 日志。十二项本次构建产生的闲置、非共享缓存按精确 ID 回收；原型服务器已停止，所有项目卷的回收均通过平台生命周期完成。

正式页面截图：[实际工具详情](continuous-bot-tools.png)、[390px Bot 页面](continuous-bot-mobile.png)。原生接口模板的空预览不作为游戏截图；既有贪吃蛇正式页另经登录态打开确认可访问。

## 阶段记录（历史原件）

以下保留实施各阶段的失败与当时待办；其中“待完成”“尚未收口”描述当时状态，当前结论以上方最终验收为准。

2026-10-16 补充：`2bf5bd9e56a728a1d2fc66be83a79e45c9a0afa2` 的 [CI 38861981825](https://github.com/wangbinquan/CrewStation/actions/runs/38861981825) 九项全绿，后端 manifest `2d98fd65094cafb37b0225b6a097056aa49f48acfc1605387d263978dc741108` 已部署七组件，Console/Runner 未变；24 次并发读取均 200（最大 3961ms）。正式页面 390px 无横向溢出，消息区 372px，浅绿色回答气泡 RGB(234,246,239)；嵌套确认 Esc 只关上层、历史关闭焦点返回入口。实机继续发现广播异步权限检查晚于外层返回，导致复用 backend 提前退出、回调出生被 SQL 拒绝。`asyncAdmissionLifetime.test.ts` 真实 PG 先红复现，然后修复为已发出的子回调保留 backend，外层返回后自身授权仍立即失效；两批共九文件 36 项/287 断言通过，精确 lint 和后端类型通过。新候选准确 CI/部署和换 Pod 冷续接仍需完成，原失败不覆盖。

## 候选实现

`651a1310ba51c3445ff0ff98611804e82749314b` 的 [CI 38864682444](https://github.com/wangbinquan/CrewStation/actions/runs/38864682444) 九项成功，后端 manifest `242e7a82d03c924b4d83aa9095803ddeeb4e21cba4937f6e4b83181a67439352` 部署七组件后，原回调出生错误消失。第三个 Bot Pod `ef809070-0cee-40f0-9ed1-16c172615783` 使用原 session/PVC，真实回答为“冷续接成功：BOT-MEMORY-9c6470d5-d3ea-4f91-9feb-753b68a38dbf”；该轮输入未重新提供标记，完整 WebSocket 历史回放 14 事件。刷新前后 9 条历史消息及草稿完全一致；登录过期后在独立登录页恢复既有身份，原草稿仍在。

父环境重建操作 `01a14393-b6fd-7001-ad38-e72250ba3803` 成功，新父 Pod UID `7b34037f-fa67-4a06-8565-3bdd51f55d79`，任务、工作卷 UID `13b9dd76-eeab-428b-90d5-7a6c66b8c6ff`、Bot 卷 UID `897430a0-a723-4295-be96-a52b9a25f28d` 保持。实机发现其后 Bot 停在 stopping：代码将观察到的清理状态误当成持续的用户停止意图。另有冷续接准备被旧执行 paused 覆盖的短窗口。真实 PG 用例先红锁定两处，改为以实际未完成操作判断停止/准备意图，七项/60 断言通过；不手动改 Bot 数据。Chrome 离开时还发现已保存草稿错误提示丢失，改为仅持久化失败才拦截离开（包括切换 CLI）；Console 13 项通过、精确 lint 与前后端类型通过。新批准确 CI/部署及原 stuck 状态自动恢复仍待验证。

独立 PG 的完整本机检查最终为 5720 pass / 176 skip / 3 fail / 3 errors，41279 断言、1201 文件、2019.06 秒。三个失败均在默认 5 秒预算超时，分别为安装脚本、provisioning 删除工作器、resource-access 多页删除用例；结束后仅对这三个文件作正常权限对照，24 pass / 0 fail / 365 断言。对照不替代全量失败；原日志保留，一次性测试 PG 已停止移除。该轮完整检查的生产候选为 `2bf5bd9e`，后续修复采用相应定向检查和准确提交 GitHub CI。

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
