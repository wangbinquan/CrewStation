# RFC-040 验证记录

2026-10-15，用户明确授权“那这个RFC040你接手”。各节按时间记录当时的证据；最终结论见末节「2026-10-18 收口」。

## 生产实现与集中验证

基线：`2274ae0473efd8fcd5cf26af5f329a212220bca6`（共享 main，与 origin/main 同步）。生产实现与测试用例先写齐，再集中执行功能验证；测试库使用独立临时 PostgreSQL 数据库，显式 `CS_TEST_REQUIRE=database`，没有改动业务生产库。

- 原生 Agent／子代理、逐协议选项白名单、发布授权四开关、内联 MCP、完整插件树及模式／安全符号链接。
- 对象材料：preparing／ready 日志、对象固定引用、限定对象的下载授权、续发授权不改摘要、流式完整性校验与取消清理。
- 命令 Secret：冻结发布环境键、项目 Secret 版本固定、同请求及 fresh retry 不随轮换漂移、Runner 接收能力位与输出脱敏。
- 实际启动清单：Claude 根 init、OpenCode 运行时客户端观测；有界、去重、当前尝试身份、冷重放与 finalCursor，初始化失败的 unavailable 也先于最终结果持久化。
- 档位证明只按实际能力探针授予新能力位；旧请求、旧材料和未宣告新能力的 Runner 保留原有行为。

集中首轮：**81 个文件，417 项，411 pass / 6 fail**，145.10 秒。修复本人引入的 registered 状态清单持久化与原型键归一化前校验；同步新增合同对应的测试预期，并修正取消用例自身的等待时序及游标过滤断言。按影响范围复验、补充受理前清单边界和合同金样用例，复用未变化范围的通过结果。

合并各文件最后有效结果：**82 个文件，425 项，425 pass / 0 fail / 0 skip**。这是本次范围的集中验证，不是全仓或实机验收结论。原始日志：

- `/private/tmp/cs-rfc040-tests.log`、`cs-rfc040-junit.xml`
- `/private/tmp/cs-rfc040-recheck.log`、`cs-rfc040-recheck-2.log`、`cs-rfc040-recheck-3.log`
- `/private/tmp/cs-rfc040-surface-final.log`
- `/private/tmp/cs-rfc040-validation.json`：候选内容摘要、文件清单和逐项最后结果；明确记录一条用例重命名。

静态：架构检查通过；97 个改动 TypeScript 文件 lint 通过；根类型检查和 console 类型检查通过。`git diff --check` 无异常。整仓 `check:static` 的 lint 被既有 `.local/cli-bot-acceptance/` 中 8 处错误阻断（probeCurrentSession、probeNewSession、renderDeployment、renderFinalDeployment、snake-source/src/game/snake）；这些文件未改动。不能把范围 lint 通过称作整仓门禁通过。

## 本机构建

独立标签构建成功，未覆盖 dev 标签：

| 镜像 | 本地配置 ID |
| --- | --- |
| `cs-control-plane:rfc040-bdac231b68cc` | `sha256:9b4d1bbc0ca84c792966b1bbe6adbd1a1b7b0a78a81ce6d01504cd861c2a718d` |
| `cs-task-runtime:rfc040-bdac231b68cc` | `sha256:34e664fd579e25b7a9d9d8099a45e3553a0ab8fb324985bdc6360a9fa79ad458` |

构建日志：`/private/tmp/cs-rfc040-control-build.log`、`/private/tmp/cs-rfc040-runner-build.log`。以上是本地配置 ID；集群导入后的 OCI manifest digest 另行核对，不能混称。

## 准确提交与本机部署

生产实现提交：`92889e87a7be3db1cbc4f2aad8c63a85f1f577c9`，106 个精确路径。对应 [CI 38838520891](https://github.com/wangbinquan/CrewStation/actions/runs/38838520891) 九项全部成功，包括 `gate` 和 `e2e`。本地 ignored 文件 lint 的历史失败保留，不能改称原本地全量成功。

通过本机官方存储预检与不可变镜像导入后，仅升级七个后端（cs-api、cs-session、cs-controller、cs-auth、cs-events、mcp-capabilities、mcp-operations），均 Ready 1；console 保留既有版本。实际 OCI manifest：

- 控制面：`sha256:004edc4ee8e73ae03254c9d8d172e54fec601229d1481fc27798871eddccedb0`
- Runner：`sha256:b27a7fb8ebf7134c2e53585cb55248eb4d054aa5da122af6c0b6989d76da88b7`

`crewstation-rfc040-migrate-92889e87` 作业完成，新增且仅新增 `business_task/0038_material_objects.sql`（applied 1，rolesInitialized 0）；此前迁移摘要不变。镜像导入、部署前后快照及迁移证据分别在 `/private/tmp/cs-rfc040-import.log`、`cs-rfc040-targets.json`、`cs-rfc040-deploy-before.json`、`cs-rfc040-deploy.log`、`cs-rfc040-applied-migrations.txt`。节点磁盘仍紧张，未清理其他任务资源。

## OpenCode 实机验证

用户最新明确：**“不要验证claude code了，只验证opencode”**。后续只执行 OpenCode 实机验收；Claude Code 不再是本次收口条件，不宣称已实机通过。

独立隐藏档位 `01a14282-7979-7000-b517-f3d4a3207d56`（`rfc040-opencode-92889e87` r2）固定上述新 Runner，OpenCode 1.18.29、火山 AI 网关/glm-5.2。复制使用服务器端加密凭据保留能力，原 `rfc027-live-agent` 与平台默认档位未改。

真实测试 `01a14282-7a4e-7000-bfe5-90b409d97680`、任务 `01a14282-7ad9-7000-9631-9edcf03fdc6d`：真实模型轮次、events、resume、skills、MCP、nativeConfig、materialObjects 均通过。持久事件中的 `opencode-inventory` 实际观测 `crewstation-probe=connected`，三个新增能力位均为 1。结果记录 `/private/tmp/cs-rfc040-opencode-test.json`。

**保留未通过事实：systemPrompt=false。** 该 GLM 模型收到探针标记但拒绝按指令回显；原始响应保存在该任务的持久事件中。档位整体状态 passed 不表示每个可选能力通过，依赖 systemPrompt 的业务调用仍会明确被拒绝。没有篡改证明或以重测抹掉失败。

隔离项目 `rfc040-native-acceptance`（`01a1428b-7693-7000-9695-28881ae3aebc`）使用独立发布与档位继续业务 API 实机链路：完整插件树、二进制对象、模式／安全链接、local MCP、内部子代理与耐久事件。该项目最初 500m HTTP 服务滚动更新因 CPU 不足未就绪；只对该自有验收槽使用 Recreate 完成更新，再经正常 Manifest 发布切为 50m 服务规格。现有 AW 与其他项目未变。

## 业务服务身份下的完整 OpenCode 实机链路

以上隔离项目正式验收版本为 `v0.1.2`，GitLab 来源 `3619524d7fa429fa2a3f82080582ea2a62ab8698`，CS 发布 `01a1428f-eabe-7000-af4c-887037988560`。所有 `/v3` 调用均从该已登记服务 Pod 经平台网关发起，使用实际执行权租约和冻结发布合同；没有直接伪造来源身份或写业务数据库。

父任务 `01a14294-79d0-7000-b7d6-f0db13390656` 的实际证据汇总在 [OpenCode 实机证据](./opencode-live-20261015.json)：

| 旅程 | 实际结果 |
| --- | --- |
| 原生插件与对象材料 | 子任务 `01a14295-6f22-7000-8837-c05d8396f4d9` 成功；完整插件树通过相对符号链接加载依赖，读取对象文件 2,097,169 bytes 并核对 sha256，可执行脚本 mode 为 0755。对象有 material-version 固定引用，同 requestKey 重放得到相同材料，不同内容 409。 |
| 内部子 Agent | OpenCode 实际调用 `task`，`subagent_type=rfc040-helper`，返回只存在于该 Agent 正文中的随机值；仍为同一 CS 子任务内的内部委派。 |
| local／remote MCP | 子任务 `01a1429a-6033-7000-8cbe-a701b72f3d41` 成功；stdio MCP 计算注入 env 的 sha256，HTTP MCP 计算实际收到 header 的 sha256，两者均与期望一致且原值不出现在事件／结果。实际启动清单中两者均 connected。 |
| 权限与模型选项 | 插件读取实际 OpenCode 配置，报告 bash=deny、temperature=0.15、top_p=0.7；工具集中没有 bash，目标禁止文件不存在。实际 chat.params 中 topP=0.7；本 GLM 模型的温度实际采样效果未单独证明。 |
| 冷续接 | 新子任务 `01a1429c-5721-7000-a987-71630441dfb8` 在原 OpenCode Pod 退出／释放后，恢复原 session `ses_ebd69b3cdffeLzWJvzdTPtlXeb`，无工具地正确返回前轮子 Agent 的随机值。原材料摘要与档位 r2 保持；原事件完整重放。 |
| 命令 Secret | 首次命令有意 exit 7 后将项目合成 Secret 从 v1 轮换为 v2。原 requestKey 重放无重复执行；fresh retry 使用 v1，新命令使用 v2。输出分块发送原值，平台事件／结果均已脱敏；三行持久子任务数据不含任一明文，原尝试与重试 payload digest 相同，新命令不同。7 项检查通过。 |
| 取消与 fresh retry | 子任务 `01a1429f-2011-7000-a46a-c56f43f8ca5a` 产生真实 session 后取消，最终 state=cancelled／process=exited；`inventory-cancelled` 在 result 前持久输出。重试 `01a142a0-27e5-7000-8b04-e5ad4097b0f6` 成功、新 native session、attempt=2，原材料／档位保持，插件再次验证对象字节。7 项检查通过。 |
| 受理前拒绝 | 越权 model 选项、逃逸符号链接均 400，错误对象摘要 412，未授权 command env 400；没有把这些请求变成成功执行。 |

MCP／冷续接脚本 12 项、Secret 脚本 7 项、取消／fresh retry 脚本 7 项全部通过。首次插件脚本的 local MCP 断言误要求回显 env 明文，平台正确脱敏成 `***`；原失败保持，后续改用摘要完成定向实测，未更改产品脱敏行为。日志分别为 `/private/tmp/cs-rfc040-{native,extra,secret,cancel}-live.log`，原始回执为同前缀 `*-acceptance.json`，持久秘密检查为 `cs-rfc040-secret-db-proof.json`。

此处证明的是实际 OpenCode 进程退出、冷续接、取消后重试及业务事件重放；没有将其描述为完整 CS 集群灾难恢复或 AW 全链路恢复。验收项目、父卷与证据保留。

## 仍未完成

- AW RFC-370 原生材料编译、私有 Git 凭据助手及其发布契约接线仍属 AW 后续工作，不以 CS 单侧通过替代。

本机 AW 正式 `agent-workflow.cs.localhost` 保留运行。CS 部署及上述验收后再次只读核对：blue／green 均 Ready、0 restarts，Pod UID 分别仍为 `67808ecd-2cb8-418b-98f1-4e7ce338bce3` 与 `0039a97f-e2ae-4647-9913-a99b4839c1cc`。未替换、停止或删除它们。RFC 状态保持 **In Progress**。


## OpenCode 联合接线补充候选与 CI 并发用例修复

文档提交 `8e8bc0724828fc71a381be79159f4f7dab5655ec` 的 CI 38843444570 中，static、unit、console、e2e 与其余 module 分片通过；module 1/4 的 RFC-040 `nativeMaterialAdmission` 用例失败，gate 随之失败。精确日志 `/private/tmp/cs-rfc040-docs-ci-failed.log` 显示另一请求已将材料置为 ready，后进入的幂等 pin 回调仍强制要求 preparing。此断言由本会话引入并修正：第一次实际 pin 必须看到 preparing；已有 pin 的并发重入允许 preparing/ready，不改变生产状态转换。

补充候选实现 OpenCode 插件 options tuple、MCP OAuth／大小写 env 和新增字段的持久事件脱敏；源码依据和兼容扩展边界见 design。集中检查：四文件 21 pass／0 fail（包含真实 PostgreSQL 模块用例、无 skip），仅 OpenCode 驱动准备 1 pass／0 fail／5 filtered；根类型、十文件精确 lint、结构检查通过。日志为 `/private/tmp/cs-rfc040-opencode-extras-{types,tests,driver,lint,arch}.log`。这些补充字段尚未重新部署或作真实 OpenCode 模型轮次；原部署与前节实机证据仍对应 `92889e87`。


补充提交 `de9c69ccb8d28e455de1a0a6766ed7473ad85606` 已推送；准确 SHA 的 CI [38845648786](https://github.com/wangbinquan/CrewStation/actions/runs/38845648786) 中 static／unit／console／e2e／module 1–3 成功，module 4 与 gate 失败。失败点为 `modules/session/tests/sessionAdmissionProgress.test.ts:123`：四路握手及命令回执均成功，随后立即读事件列表得到 `[]`，期望 `[1]`。只读归因显示既有 `5beff15a` 让命令回复独立于排队事件持久化推进，测试最后修改在 `dcfadfba`；本补充的 13 路径没有修改该 Session 调用链。保留失败日志 `/private/tmp/cs-rfc040-opencode-extras-ci-failed.log`，不代改或回退其他 session 的代码，不声称整仓 CI 通过。共享主干随后推进到文档提交 `22d916e8`，其 CI 38846674085 也在 module 4／gate 失败；本条没有把较新的失败当成成功证据。

后续镜像导入一度受本机 Docker 节点可用空间约 1.1 GiB 阻塞。仅按精确 ID 回收 320 条至少三天未用、可回收且不与镜像共享的构建缓存，空间回升至约 2.25 GiB；完整记录 `/private/tmp/cs-rfc040-cache-reclaim-exact.json` 与同前缀日志。没有删除平台镜像、卷、容器，也没有停止或替换 AW。补充代码的部署与 OpenCode 实机验收仍待完成。

## 2026-10-15 深链／名称候选与补充字段实机验收

恢复深链仅接受合法 UUIDv7 的 project/task/subtask，使用原恢复工作台与统一 Dialog；原 child 不存在时不会自动转成父任务恢复，关闭保持筛选。原生名称上限从 80 兼容扩大到 128，与 AW 标识符能力对齐，路径逃逸与平台保留名仍被拒绝。两文件集中回归 **17 pass / 0 fail / 147 assertions**；候选八路径的前后 SHA256 一致，记录 `/private/tmp/cs-rfc040-link-name-validation.json`。`bun run check:static` 的架构、全仓 lint、后端与 Console 类型均通过；该批 UI／名称候选没有重新运行整仓功能门禁，也尚未提交或部署。

后续只读核对发现，并发发布的 `3fb767e61c1e6878af01ae81efadbb6ab6e1bc6c` 已包含 `de9c69cc` 补充，准确 [CI 38855659848](https://github.com/wangbinquan/CrewStation/actions/runs/38855659848) 九项成功。本轮模型实测前 cs-api／cs-session／cs-controller 镜像为 `sha256:7bb49c8178f5ff49649b528b477611ff42ba5db05021a565b237d99d2c5e2d06`；Runner 配置为 `sha256:0f87aceb9eb8c51ac3dd97bc4460e4d5b101aa6482b1d7f0bd41c590a3254e79`，与该发布回执一致。原 `de9` 准确 CI 的失败历史保留，不能改写为当时已绿。

仅更新隔离 OpenCode 验收档位 `01a14282-7979-7000-b517-f3d4a3207d56` 到 r3／该固定 Runner，保留原配置和凭据，未改平台默认档位。首次自动测试 `01a14361-1f93-7000-b0d2-defbd89be246` 为 environment-lost：容器启动前的 Job 续租查询失败。只读证据显示 Docker 节点可用空间为 0，PostgreSQL `could not extend file ... No space left on device`；不是已执行后模型失败。

按精确 ID 回收 326 条至少 12 小时未用、可回收且不与镜像共享的构建缓存，工具报告 1.869 GB，随后节点可用空间约 3.76 GiB；记录 `/private/tmp/cs-rfc040-diskfull-reclaim-exact.json` 与同前缀日志。没有删除镜像、卷、容器或停止正式 AW。环境恢复后的手工测试 `01a14366-4b0a-7000-9dd8-b0f7b983b824` passed，真实模型、resume、MCP、nativeConfig、materialObjects 及启动清单能力成功；原失败另存，不覆盖。

原隔离父任务 `01a14294-79d0-7000-b7d6-f0db13390656` 上的新子任务 `01a1436b-6137-7000-9938-1d16f43e6e94` 使用 r3／上述镜像，实际 OpenCode 调用插件和 local MCP 后 succeeded／exitCode 0。18 项实机回执检查通过，见 [补充证据](./opencode-options-live-20261015.json)：

- 原生插件 tuple 的 options（布尔值、随机标记及秘密叶值）在实际 OpenCode 配置中保留；文件回执校验内容 SHA256 与大小。
- OAuth 显式 clientId／clientSecret／scope 和 `oauth:false` 在原生 MCP 配置中保留，三个 MCP 均 connected；未将该测试描述为外部 OAuth 授权握手。
- 小写与混合大小写 env 在真正的 MCP 子进程中读取，回执摘要与原输入相符。
- 原始 options nonce 在公共事件中被 `***` 替换。首次脚本错误地断言应出现原 nonce，因此失败于 `observed-nonce`；保留原脚本及失败日志，后续直接核对同一次执行的原生文件和持久事件，没有重跑或替换该模型轮次。新增四类合成秘密的摘要检查、事件回放与实际工具调用核对全部通过。

最新范围仍只有 OpenCode；没有启动 Claude Code 验证。尚待裁定的子代理独立模型合同见 [补充设计](./model-mapping-supplement.md)／实施问题 I37；它与本节已完成的同模型／字段实测分开。RFC-040 保持 In Progress，不以 CS 单侧证据代替 AW RFC-370 完整接线验收。

时序复核：本轮子任务实际执行为 `2026-10-16T06:34:47.210Z` 至 `06:35:55.184Z`。平台随后并发更新到 `sha256:2d98fd65094cafb37b0225b6a097056aa49f48acfc1605387d263978dc741108`，新 cs-api／controller／session Pod 分别在 `06:46:41Z`／`06:46:53Z`／`06:47:38Z` 创建，均晚于本轮模型完成；本节原生实测继续归属 3fb767e6 与固定 r3 Runner，不外推后续整套版本验收。


## 2026-10-16 独立子模型候选

用户已批准平台档位引用和固定 provider 材料的推荐方案。生产实现及用例已写齐，集中门禁与修复复验记录见 [RFC-042 验收](../RFC-042-service-database-restore/acceptance.md)。三个候选镜像已构建并校验导入；GLM-5.2 根与 DeepSeek V4.1 Flash 子代理的真实 OpenCode 委派待新版部署后验证。源档位和默认档位保持，验收使用独立隐藏副本。下方或上方旧记录均只覆盖当时的候选。


## 2026-10-16 推荐方案部署及实机缺陷修复

`3c1d2eab` 推荐实现及 `15f6eee2` 两个实机缺陷修复的准确 SHA CI 均九项全绿，八组件已部署 Ready，正式 AW 两个 Pod UID 和零重启保持。纯摘要引用复制／保存已通过实际 API，GLM 与 DeepSeek 隐藏副本 r2 已创建，源配置与默认档位均不变。两个真实 OpenCode 探针正在执行，跨模型委派尚未通过；单节点 CPU 限制下使用另一个 50m 服务／100m 任务的隔离项目继续。完整证据与边界见 [最新部署记录](../RFC-042-service-database-restore/acceptance.md#2026-10-16-推荐方案部署及实机缺陷修复)。

## 2026-10-17 任务镜像验证心跳缺陷（AW RFC-370 托管验收发现）

AW 任务镜像（已有镜像修订，底座 `7701acd4`）的任务用途验证在真实平台上 200ms 内以 unknown「验证已取消或租约丢失」结束，没有创建任何验证 Pod。本机运行镜像验证表的最后一次 passed 停在 2026-09-27，即 `463f24d8` 给运行写入加项目删除准入之前。根因：Runner 探针经 task-runtime 的 `runRuntimeImageProbe` 进入 task-runtime 自己的嵌套共享准入，嵌套作用域只携带 `task-runtime.project-admission` 键（`nestedAdmission.test.ts` 明确锁定这一作用域隔离）；探针在其中回调验证心跳时，心跳核对 runtime-environment 的准入键必然抛错，于是第一次心跳即为 false。

修复 `8d127df9`：心跳用 `AsyncLocalStorage.bind` 固定在创建它的原验证回调上下文中执行；嵌套作用域的权限隔离不变，删除封闭仍使心跳为 false。回归用例在另一模块的嵌套准入中回调心跳，修复前得到 `[true, false]`，修复后 `[true, true]` 且验证按 executor 结果落定；`projectAdmission.test.ts` 17 项、runtime-environment 验证／注册表与 task-runtime 共 262 项通过。完整本地门禁（默认测试库）5792 pass／176 skip／2 fail：两项为 `roleRemoval` 与 `nativeProjectDeletion`，要求 `max_prepared_transactions > 0`，在 `max_prepared_transactions=10` 的独立测试库上这两个文件 27 项全过；原失败记录保留。准确 SHA CI `39007600564` 九项全部成功，本机已部署（控制面 `cs-control-plane@sha256:fd10be14…`，Runner 底座 `task-runtime:dev` 仍为 `5a748ec6…`）。

部署后同一版本重新验证：越过心跳进入环境创建，但验证 Pod 因单节点 CPU 不足（平台缺省任务档位 `coding-medium` 1 CPU，节点请求 9.1／10 核）无法调度，按截止时间以「验证环境未能完成初始化」结束。另：本机平台的运行镜像底座仍固定为 `CS_BASE_IMAGE_TAG=rfc027-final-0c8be5fd`，其 Runner 不声明本 RFC 的 `commandSecretEnvVersion`，以项目 Secret 注入命令环境的任务镜像需要改回当前底座；这两项属共享平台配置，待用户决定。

## 2026-10-17～18 AW RFC-370 托管验收：阻塞收口与 Agent 子任务容量缺陷

上节两项共享平台配置已由用户裁定：`crewstation-env` 的 `CS_BASE_IMAGE_TAG` 改回 `dev`；每次任务镜像验证期间临时把 `CS_DEFAULT_TASK_PROFILE` 指向小档位、只重启 cs-controller，验证后恢复（当前未设置）。复跑验证又发现 `191f9ad1`（目录事务嵌套在调用方准入内，此前所有固定项目任务镜像的 `POST /v3/business-tasks` 都 500），[CI 39020650971](https://github.com/wangbinquan/CrewStation/actions/runs/39020650971) 全绿后本机部署控制面 `cs-control-plane@sha256:550d6831…`。此后 AW 任务镜像版本 `01a14d79-f0d5-7000-97c0-3993eac11ce7` 的验证 `01a14d7a-382c-7000-a953-de2348e26894` 通过，AW 父任务以 `selectionSource: configuration` 固定该镜像，五项工具检查全过。AW 侧托管验收（M1、蓝绿交接、事件入站、archive-and-delete 父任务删除后工作卷回收等）的证据记在 AW 仓 `design/RFC-370-crewstation-hosted-deployment/status.md`，本节不重复。

**新缺陷：已 2xx 受理的 Agent 子任务被后台按容量拒绝后永久 pending。** AW 托管 M2 控制流任务 `01M5798CMMH92MAD2405HFTXXK` 的澄清续跑节点在 10:49:42 UTC 提交子任务 `01a14ea1-b56f-7000-baf1-70171dc43a5e`。当时项目并发额度 3 已被该父任务、AW 共享系统工作区及其系统 Agent 占满，提交按设计得到 429，AW 以同键退避重放（cs-api 记录 14 次「项目并发额度已满，子任务未启动」）。10:50:09 AW 记下 2xx 受理，cs-api 的额度拒绝日志止于 10:50:07.893。按代码推断：重放先 `adoptPending` 把子任务改回 pending，后台 worker 与同步路径竞争 claim；同步路径 claim 不到时按 `dispatching` 回 200，后台的准入随即遇到额度不足，把子任务记为 `retryable-rejected`（未直接读平台库核对 dispatch 列；同步路径因暂时性错误回 202、后台再遇额度不足，结果相同）。该状态后台不再 claim，只有同键重放才能重新准入，而调用方已拿到 2xx、没有理由再重放。系统 Agent 10:52:21 结束、额度空出后子任务仍无 Pod，直到 AW 30 分钟节点截止取消（`cancelled-before-start`）。

这与本合同「已受理后只能继续原操作，不能再变成未受理 429」的意图相悖。修复让 `dispatchBusinessAgent` 区分结果的接收方：提交／重试请求仍在等待时，容量不足照旧记为可重试拒绝并答 429；后台 worker 继续已答复的子任务时，容量不足保持 pending，由 worker 在额度空出后继续准入，环境 ID 不变。RFC-027 设计 §3 对应条目已补充说明。回归用例 `executionAgents.test.ts`「a capacity rejection after the 2xx answer stays queued…」：首次提交因暂时性准入失败得 202，随后后台两次遇额度不足，额度恢复后同一环境 ID 准入并启动 Agent。修复前该用例得到 `retryable-rejected`，修复后通过；原「quota rejection never queues capacity retry」同步 429 用例不变，相关四文件 15 项通过；完整本地门禁（独立测试库 `max_prepared_transactions=10`）5804 pass／176 skip／0 fail。`621e6183` 的准确 SHA [CI 39125433559](https://github.com/wangbinquan/CrewStation/actions/runs/39125433559) 全部成功，本机部署控制面 `cs-control-plane@sha256:9b0c1c3d…`（八组件 Ready，平台配置 `CS_BASE_IMAGE_TAG=dev`、缺省任务档位未设置保持不变，正式 AW 两个 Pod 未重启）。部署后对原失败任务的父任务发起平台恢复动作 `resume-task`（请求 `01a14eef-530f-…` 21 秒内 succeeded），AW 续跑后澄清节点的新尝试完成，评审门批准后任务 done，结果与单机对照逐端口相同。

**OpenCode 工具结果在业务事件中丢失。** 同一轮 AW 托管验收中，AW 的节点会话树把每个 OpenCode 工具调用都显示为「运行中、无输出」：业务事件流对每个工具只有 `tool-start`，没有 `tool-end`。OpenCode 的 `run --format json` 只在工具 part 已 completed 或 error 时输出一次 `tool_use`（opencode `packages/opencode/src/cli/cmd/run.ts:717-720`），驱动因此在 `tool-start` 上已带回执与错误标记，而业务投影只取名字与输入。修复：带结果的 `tool-start`（OpenCode 的已完成调用）投影为 `tool-end`，`tool-end` 契约新增可选 `input`（契约金样：破坏性 0、新增 1）；只有输入的开始事件（Claude 的 `tool_use`）照旧是 `tool-start`。Agent 事件流本身不变，工作台 Bot 记录与档位探针不受影响。回归用例 `agentProjection.test.ts`：已完成与出错的 OpenCode 调用各投影为带输入的 `tool-end`，修复前该用例失败；无结果的开始事件保持 `tool-start`，三者都通过业务事件模式校验。完整本地门禁 5805 pass／176 skip／0 fail。

## 2026-10-18 收口：工具结果投影部署与 AW RFC-370 联合验收（Done）

**投影修复的 CI 与部署。** `02b66a22` 的准确 SHA [CI 39130776880](https://github.com/wangbinquan/CrewStation/actions/runs/39130776880) 唯一失败在 `runtimes/task/tests/runnerLifecycle.test.ts` 的预览监督用例：该文件不在本提交的改动与依赖范围内（本提交只改业务投影与 `tool-end` 契约），原失败记录保留、未认领。紧随其后的 `34331a3c`（RFC-042，父提交即 `02b66a22`，投影相关文件未改）的 [CI 39133757698](https://github.com/wangbinquan/CrewStation/actions/runs/39133757698) 全部成功，作为包含本修复的后继证据。`34331a3c` 已部署本机：控制面 `cs-control-plane@sha256:17bb84bf…`、控制台 `cs-console@sha256:4ed20b0b…`，平台配置不变（控制台镜像的依赖安装在无代理时挂起，改以代理预构建后再执行安装脚本）。安装脚本同时重新发布了任务底座 `task-runtime:dev`（`5a748ec6…` → `5acdc4da…`）；`CS_TASK_IMAGE` 按摘要固定底座并进入任务用途验证的合同摘要（`modules/platform/application/runtimeImagePorts.ts:58`），已有任务镜像验证随之失效，AW 正式服务约 10 分钟内的任务启动被 `412 image_usage_unvalidated` 拒绝，重新验证后恢复（详见 AW `design/RFC-370-crewstation-hosted-deployment/status.md`）。这是运行镜像验证的既有设计，不属本 RFC 范围；平台升级换底座后须重新验证在用的任务镜像。

**AW 托管实测：工具调用以完成态显示输入与输出。** AW 任务 `01M57RVYMS1S6BDJM4MR5F5WWB`（AW 正式 v0.6.19，OpenCode 档位 `opencode-go/deepseek-v4.1-flash`）要求 Agent 用 bash 执行 `echo tool-end-$((6*7))`：节点会话树中该工具调用为 `completed`，输入 `{"command":"echo tool-end-$((6*7))"}`、输出 `tool-end-42`；同一会话经 AW v0.6.21 预览槽在真实浏览器（Playwright 无头 Chromium）中渲染为「工具调用 bash 已完成 … 工具返回 tool-end-42」。修复前同类调用一律显示为运行中、无输出。

**T6 联合验收（按用户裁定只验证 OpenCode）。** AW 侧证据均记在 AW 仓 `design/RFC-370-crewstation-hosted-deployment/status.md`：

| 能力 | AW 托管证据 |
| --- | --- |
| 原生材料：托管技能、远程 MCP、内部子代理（跨模型） | `01M5698XA6Q9AGV9ZKDM9W0XHX`：三个端口逐字等于技能／MCP／子代理各自的随机标记；启动清单 verified；平台用量按 `glm-5.2` 与 `deepseek-v4.1-flash` 分列 |
| 本地 stdio MCP、Git 插件、权限 | `01M57CSZ2BS5YAVZJ7A2PAJS9Q`：插件 system transform 生效、插件 `config` 钩子看到 `bash=deny`、模型工具清单无 bash；MCP env 秘密在公共事件中为 `***` |
| 私有 Git（命令 Secret） | M1 `01M5634T53TYTZVM2RPZTD4439`：凭据以项目 Secret 引用注入卷内命令，提交推送到本机 GitLab 项目 550 |
| 重启／接管与恢复 | `01M573PVYFDZZNRS2E4GPTPQQK`：服务切流时新实例按原运行 ID 接管流式中的 Agent 子任务，无第二次执行；`01M5798CMMH92MAD2405HFTXXK`：额度缺陷修复（`621e6183`）后经平台恢复动作 `resume-task` 续跑至 done |
| 工具结果 | 上文 `01M57RVYMS1S6BDJM4MR5F5WWB` |

**结论：RFC-040 Done（2026-10-18）。** T1–T7 的生产实现与用例、准确 SHA CI、本机部署、CS 单侧 OpenCode 实测与 AW RFC-370 联合实测均已完成。按用户裁定未做 Claude Code 实机验收：双协议的生产实现与合同用例保留，但按「能力影响补充」表，Claude 档位不宣称原生能力，需要时另立 RFC 补齐 Claude 探针后开放。「能力影响补充」表随 `61478743` 落地；用户 2026-10-18 授权本会话统一审视并自主推进或关闭 RFC-040／042，据此收口，未另行记录逐项确认。
