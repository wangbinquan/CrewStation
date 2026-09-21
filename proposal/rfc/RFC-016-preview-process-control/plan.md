# RFC-016｜实施与验证

状态：Draft · 2026-09-21 · 待作者批准，尚未开工。所有任务为未执行。

## 任务

| 编号 | 内容 | 依赖 |
|---|---|---|
| RFC-016-T1 | 契约：`startPreview`／`stopPreview`／`previewLogs` 命令与结果、hello 的 `previewControl: 1`、`PreviewStatusDto`／`PreviewLogsDto` | — |
| RFC-016-T2 | `previewOutputBuffer.ts`：双上限环形缓冲、单行截断、`attempt` 标记、脱敏 | T1 |
| RFC-016-T3 | `PreviewSupervisor` 接缓冲；`start()` 幂等与计数语义；三条命令接进 `commandHandlers.ts`；`runner.ts` 宣告能力位 | T2 |
| RFC-016-T4 | `commandDispatch.ts` 按 `previewControl` 挡旧容器，错误码 `preview_control_unavailable` | T1 |
| RFC-016-T5 | `modules/dev-session/application/previewControl.ts`：状态／控制／日志三个用例、两档授权、未连接与无会话分支；接进 `moduleApi.ts` 与 `wiring.ts` | T1 |
| RFC-016-T6 | 五条 cs-api 路由 ＋ `packages/api-client/resources/devSession.ts` 五个方法 | T5 |
| RFC-016-T7 | 操作 MCP：`read_preview_status` 补全，新增 `control_preview`、`read_preview_logs`，工具描述写明两条消歧 | T6 |
| RFC-016-T8 | 工作台：store 命令迁 REST（事件订阅保持），停止／启动按钮与文案，停止态与崩溃态分开表达 | T6 |
| RFC-016-T9 | 各层测试补齐（见 design.md §验证），本地完整门禁 | T3、T4、T7、T8 |
| RFC-016-T10 | 本机集群部署，PV-01…PV-18 实机验收，回填本文件与 `STATE.md` | T9 |

## 验收清单

未执行。每项须记录实际观察，不得由代码推断。

### Agent 自主修复链（经操作 MCP，真实开发会话）

| 编号 | 项 |
|---|---|
| PV-01 | 预览正常时 `read_preview_status` 返回 `ready` 与端口、`restarts: 0` |
| PV-02 | Agent 改坏开发命令的被调用目标（如删掉入口文件）后，预览进入 `crashed`，`read_preview_status` 给出非空 `lastError` 与 `restarts` |
| PV-03 | `read_preview_logs` 返回预览进程自己的最近输出，能从中读到崩溃原因；输出里不含 Runner 与 CLI 的行 |
| PV-04 | 崩溃前那一次运行的输出仍在缓冲里，`attempt` 标记可区分两次运行 |
| PV-05 | Agent 修复后 `control_preview{action:'restart'}` 受理，状态经 `starting` 回到 `ready` |
| PV-06 | `control_preview{action:'stop'}` 后预览进入 `stopped` 且**不自动拉起**（观察至少超过一个退避周期） |
| PV-07 | 停止后端口空出，Agent 在 CLI 终端里手动跑通同一条 dev 命令 |
| PV-08 | `control_preview{action:'start'}` 后回到 `ready`，`restarts` 归零 |
| PV-09 | 已在跑时 `start` 返回 `preview_already_running`，不产生第二个进程 |

### 边界与失败模式

| 编号 | 项 |
|---|---|
| PV-10 | Manifest 无开发命令的项目：三个工具都返回 `preview_disabled`，文案指向重开会话 |
| PV-11 | 旧 Runner 镜像的存量会话：`stop`／`start`／`logs` 返回 `preview_control_unavailable` 的 precondition；`read_preview_status` 与重启**仍然可用** |
| PV-12 | 容器未连接时返回 precondition，不伪装成 `stopped` |
| PV-13 | 只读成员（`view`）可读状态与日志，控制动作 403；非成员全部 403 |
| PV-14 | 缓冲打满后 `dropped` 计数增长，返回行数不超过 `limit` 上限，单行超长被截断并标记 |
| PV-15 | 预览输出里的凭据在 `read_preview_logs` 结果中已脱敏 |

### 工作台迁移

| 编号 | 项 |
|---|---|
| PV-16 | 重启按钮改走 REST 后功能不变；`previewState` 实时事件仍即时更新状态，请求回执不覆盖更新的事件 |
| PV-17 | 新增停止／启动按钮；「已停止」与「已崩溃」文案可区分；停止时预览地址不可点 |
| PV-18 | Agent 在 MCP 侧停止预览后，工作台页面在不刷新的情况下反映出 `stopped` |

## 开放问题

按仓库规则，实现中发现的设计缺口记入 `docs/engineering/implementation-open-questions.md`，不就地裁定。本 RFC 已知一条待作者裁定：

- **预览被 Agent 停住后是否需要提醒。** 现行空闲提醒只看会话活动时间，不看预览状态。Agent 停了预览又没启回来时，项目成员可能在不知情的情况下访问到 502。选项：(a) 不加，由工作台状态自证；(b) 预览非 `ready` 超过阈值时并入既有空闲提醒；(c) 独立提醒通道。
