# RFC-034 v2 本机部署与实机对账（2026-10-15）

对应 [v2 重新设计](./redesign-v2-20261014.md) 的 T8：精确提交的 CI、本机部署，并以档位测试、业务子任务、开发 Agent、「＋ CLI」四类执行逐条与原生存储对账。

## 1. 发布

| 源码 | 内容 | 精确 CI |
| --- | --- | --- |
| `3d7a680a` | v2 主体（断代迁移、执行记录、计量、两级统计页、价格与费用可见性） | run 38696784109：除 e2e 外全部成功；e2e 由本 RFC 的统计页实机用例发现 390px 英文横向溢出 4px |
| `4d8cc2d9` | 时间范围从页签条附加槽移到页头操作区（页头在窄屏整体换行） | run 38699494497：static / unit / module×4 / console / gate / e2e 全部成功 |
| `4990a699` | 日柱图当天明细不再把全未定价的一天显示成 ¥0（日桶补不完整与未定价执行数） | run 38707202733：全部成功 |

部署走官方路径：`git archive <sha>` → 只带 `.local/gitlab.env` → `deploy/local/install-platform.sh`（本机已关闭用户名密码登录，不带管理员口令，脚本按设计跳过目录播种与登录器重装）。

- `4d8cc2d9`：四个镜像与按精确归档预构建的镜像 ID 一致（控制面 `4bcc69ef`、console `84b03400`、任务底座 `ff4c255a`、builder `35cf5829`）；迁移 287 → 292（dev_session 0022、observability 0045、resources 0011、session 0017、task_runtime 0026）；新底座发布为 `crewstation/task-runtime:dev@sha256:e6ea3423…`，`CS_TASK_IMAGE` 随之更新，v1 报告卷配置 `CS_RUNTIME_REPORT_DATA_ROOT` 移除。
- `4990a699`：控制面 `20a405f7`、console `4c01d51f`、任务底座 `bd30f38c` 均为精确归档预构建的镜像，builder 未变；无新迁移（仍 292）；底座重新发布为 `task-runtime:dev@sha256:78882f28…`，`CS_TASK_IMAGE` 随之更新。约 14 分钟后（09:21 UTC）并行会话把控制面与 console 切到其 `e3559f0d` 构建（包含 `3d7a680a`、`4d8cc2d9`、`4990a699` 与 RFC-039 首次交付），之后线上日柱图当天明细显示「23 次执行 · 未定价」、Token 带下界，修复生效。

## 2. 档位指向新底座

档位修订按摘要钉住镜像，旧修订里的 Runner 不产生 v2 快照（这些执行记为用量未知，不是 0）。为实机验证，把 RFC-034 自己的两个验收档位各保存一个新修订，镜像改为 `crewstation/task-runtime:dev`（`e6ea3423`，Runner 协议 3、OpenCode 1.18.29）；保存即测试，两次档位测试均 passed：

- `obs-native-development-20261007` r4 → r5（原镜像为未带标签的旧底座）；
- `rfc027-live-agent` r4 → r5（原镜像为 v1 的 `runtime/observability-qa:classification-542d98820606`）。

其他档位（含平台默认档位）未改动；管理员需要把仍钉在旧底座上的档位保存到新底座，才会有 v2 用量。

## 3. 四类执行对账

原生侧用独立脚本只读汇总 OpenCode 库里的 `step-finish`（按 assistant 的 `providerID/modelID` 分组，输出加回推理一次），与 `observability.agent_calls` / `agent_call_models` 逐条比对。下表 Token 依次为输入 / 缓存读 / 缓存写 / 输出（含推理）/ 其中推理。

| 类别 | 执行 | 记录 | 原生存储 | 结论 |
| --- | --- | --- | --- | --- |
| 档位测试 `platform/profile-test` | 两次测试共 12 次（每次 1 个协议轮次 + 5 个业务能力实测） | 全部 done / complete，按实际模型 `火山AI网关/glm-5.2` 拆分，未配价格显示「未定价」 | 测试 Pod 结束即回收，无法事后读取 | 记录与受理链路通过；计量算法由下面三类对账覆盖 |
| 业务子任务 oneshot `business/subtask` | rfc027-live，以应用自身工作负载身份调用 `/v3` | done / complete：5772 / 10176 / 0 / 151 / 124 | 会话 `ses_ec17002a…`（2 步）：5772 / 10176 / 0 / 151 / 124 | 一致；业务 `usage` 事件携带同形快照，旧四个合计字段一致 |
| 业务子任务 interactive 首轮 | 同一业务任务 | 首轮 complete：5863 / 18112 / 0 / 222 / 132；取消后 canceled / partial，数值保留 | 会话 `ses_ec16e483…`（3 步）：5863 / 18112 / 0 / 222 / 132 | 一致；取消为下界 |
| 开发 Agent `development/agent` | rfc027-live 开发会话（原卷重建到新任务镜像） | 首轮 complete：6017 / 13376 / 0 / 355 / 321；取消后 canceled / partial | 会话 `ses_ec16b20f…`（2 步）：6017 / 13376 / 0 / 355 / 321 | 一致 |
| ＋CLI `development/cli` | 同一开发会话，经工作台同一条终端 WebSocket（attach → 取得控制 → 键入）在 OpenCode TUI 中真实输入一轮 | 10 秒采样先记到第 1 步（5898 / 4096 / 0 / 39 / 26），第 2 步后追上 5977 / 14080 / 0 / 60 / 27；停止后 canceled / partial | TUI 根会话 `ses_ec15234e…`（2 步）：5977 / 14080 / 0 / 60 / 27 | 一致；该原生库与开发 Agent 共享（档位把 `OPENCODE_DB` 设在共享工作卷），CLI 只汇总自己 TUI 的根会话树 |

第一次「＋ CLI」在首轮第一个 step 完成前 TUI 进程即被信号终止（exitCode 为空，正值宿主机资源耗尽窗口），记为 failed / none；原生库里该会话没有任何 step，与「未知不是 0」一致。

业务任务验收后已关闭，开发 Agent 与 CLI 已结束；rfc027-live 的开发会话保留为重建后的运行状态。

## 4. 页面

系统页（近 24 小时）：17 次执行，Token ≥ 191,170（输入 47,089 = 平台 23,460 + 项目 23,629；缓存读 142,644；输出 1,437，其中推理 978），4 次用量不完整故为下界，16 次未定价。项目页 ≥ 80,161，人民币按项目费用可见性隐藏，5 次执行（1 完成 / 1 失败 / 3 取消）。数字与数据库逐项一致。

实机查看时发现日柱图当天明细把全未定价的一天写成「¥0.00」、Token 未标下界，与总览卡口径不一致，由 `4990a699` 修复（日桶补 `incompleteCalls` / `unpricedCalls`，明细复用总览卡格式，用例覆盖全未定价与含不完整的一天）。

## 5. 环境观察（非本 RFC 缺陷，如实记录）

- 平台 PostgreSQL `max_connections=100`：控制面连接池约 55 条、二十多个项目应用各自的连接池约 42 条，验收期间到 97/100 并出现 `too many clients`；既有的「项目工作准入」长事务（`withSharedDatabaseAdmission`，每条占一个连接并周期 `SELECT 1`）被 idle-in-transaction 超时断开后，开发会话读取返回 502。
- 08:05–08:10 UTC Docker 虚拟机全局 OOM（同时段宿主机另有约 12.5 GB 的并行校验容器、本机 GitLab、docker-scout 镜像分析等），cs-session / cs-controller / cs-api 各重启一次后恢复，之后内存正常（cs-api 约 286 MB / 限额 1 Gi）。

## 6. 未覆盖

- Claude Code：本机没有可用的 Claude Code 档位（无登录凭据），assistant 去重、`result.modelUsage`、OTel `api_request` 采样只有用例覆盖，未实机。
- 价格：未向共享环境追加价格线（只追加、不可撤回）；价格选择、按开始冻结与整数纳元计价由真实 PostgreSQL 用例覆盖。
