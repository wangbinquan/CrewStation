# 用例防护体系

> 状态：生效中（2026-09-20 确立，结构性规则见 [ADR-0007](../adr/0007-test-protection-system.md)）
> 版本：0.1 · 日期：2026-09-20
> 适用范围：本仓的全部用例与 GitHub CI，人写的与 Agent 写的一视同仁

本文管三件事：**防护用例放在哪、必须写哪些、CI 怎么执行它们**。
「改动必须自带测试」这条规则本身在 `development-rules.md` §4，本文是它的展开；用例分层沿用 Plan §10.1，不另起一套。

## 目录

- [0. 现状与这份文档要补的洞](#0-现状与这份文档要补的洞)
- [1. 三条总原则](#1-三条总原则)
- [2. 用例分层](#2-用例分层)
- [3. 用例放在哪](#3-用例放在哪)
- [4. 改什么，必须带什么用例](#4-改什么必须带什么用例)
- [5. 环境能力与跳过](#5-环境能力与跳过)
- [6. 业务契约面金样](#6-业务契约面金样)
- [7. 迁移锁](#7-迁移锁)
- [8. CI 执行体系](#8-ci-执行体系)
- [9. 编写要求](#9-编写要求)
- [10. 已知的防护缺口](#10-已知的防护缺口)
- [11. 命令速查](#11-命令速查)

## 0. 现状与这份文档要补的洞

2026-09-20 在本机实测（含 PostgreSQL、GitLab 与实机浏览器）：266 个用例文件、1642 条用例，生产代码行覆盖率 95.9%。
用例本身并不缺，缺的是**让它们不会悄悄失效的机制**。动手前核对出的洞，每一个都能让门禁「绿着坏掉」：

| 洞 | 证据 | 现在由谁堵 |
|---|---|---|
| 数据库连不上时约 60 组集成用例整层 `skipIf` 跳过，`check` 照绿 | `packages/testkit/database.ts` 原先只告警并返回 false | §5 能力闸门 |
| e2e 作业里登录失败时整套用例跳过，作业照绿 | `tests/e2e/session.ts` 原先吞掉一切异常 | §5 能力闸门 |
| 「改动自带测试」只是文字，没有任何机械检查 | `development-rules.md` §4 | §8 新增代码防护 |
| 约定表（头名、环境变量名）改名，平台用例全绿 | 全仓只有一处对单个字面值的断言；模板与接入容器里的名字是手抄的 | §6 契约面金样 |
| 改已应用的迁移，CI 永远是绿的 | 运行器只在已应用过的库上比校验和，CI 的库每次都是空的 | §7 迁移锁 |
| `.only` 在本机静默吃掉同文件的其余用例 | Bun 只在 `CI=true` 时才拒绝 `.only` | §9 与 `test-discipline` 规则 |
| 跳过了什么、删了什么用例，没有任何地方看得见 | CI 只有一屏日志 | §8 作业摘要 |

## 1. 三条总原则

1. **绿必须等于跑过。** 用例可以因为环境缺席而跳过，但跳过必须看得见、说得出原因，而且在「环境本来就该在」的地方（CI）跳过就是失败。
2. **防护跟着改动走。** 不设存量基线、不登记债务：闸门只看本次推送改动的行，改到哪里，哪里就必须有用例执行到。
3. **对外的东西单独锁。** 已部署的数字人依赖的契约面、已应用的迁移，平台自己的用例测不出它们被改坏；这两样各有一把锁，改动必须是一次看得见的动作。

## 2. 用例分层

| 层（Plan §10.1） | 证明什么 | 位置 | 需要的环境 | 在哪跑 |
|---|---|---|---|---|
| 结构 | 仓库规则本身有效；真实仓库零违规 | `tools/arch/tests/` | 无 | `check` |
| 契约 | 跨进程数据形状：正向解析、`strict` 拒绝未知键、业务契约面金样 | `packages/contracts/**`；各单元对自己那部分契约面的锁（如 `modules/business-task/tests/serviceRouteSurface.test.ts`） | 无 | `check` |
| 单元 | 纯领域规则：状态迁移、判定、校验 | 源码旁的 `*.test.ts` | 无 | `check` |
| 模块集成（Plan 的「组件集成」） | 用例层＋真实 PostgreSQL＋HTTP 路由；一个模块对外的全部行为 | `modules/<name>/tests/`、`packages/<name>/tests/` | `database` | `check`（点名要求） |
| 工作台渲染 | 页面与组件在给定数据下的行为：载入、空、错、成功与交互 | `apps/console/src/tests/` | happy-dom | `check` |
| 外部系统集成 | 真实 GitLab、真实集群、两个原生 Agent CLI 的适配 | 所属单元的 `tests/`，各带环境闸门 | `gitlab`、`CS_TEST_K8S=1`、`CS_NATIVE_ACTIVITY_ACCEPTANCE=1` | 本机（§10） |
| 实机端到端 | 部署出来的平台：真网关、真登录、真后端、真浏览器 | `tests/e2e/` | `e2e` | `e2e`（点名要求） |
| 故障与升级、安全、规模 | Plan M4–M6 的验收 | `tests/upgrade/`、`tests/security/`、`tests/scale/` | 待定 | 未建立（§10） |

同一个行为优先写在**能断言它的最低一层**：能抽成纯函数就写单元用例，不要拿实机用例去测一个判定分支。
反过来，渲染用例把 `fetch` 打了桩，后端换了字段它照绿——跨进程的真实性只有实机层能证明，两者互补，不能互相替代。

## 3. 用例放在哪

| 单元 | 位置 | 说明 |
|---|---|---|
| `modules/<name>` | 集成用例在 `tests/`；纯函数的单元用例就近放 `domain/x.test.ts`（其他层同理） | `bun run scaffold:module` 生成 `tests/<name>Module.test.ts` 作为主集成用例；`tests/` 是除 `wiring.ts` 外唯一能 import 其他模块（根入口）的地方 |
| `packages/<name>` | 就近 `*.test.ts`，或 `tests/` | 夹具与替身也放 `tests/`（`fakeProcessHost.ts`、`fakePlatform.ts`） |
| `apps/console` | 全部在 `src/tests/`，不与组件混放 | 夹具叫 `*Fixture.ts`；整页旅程用 `renderApp`，单个组件用 `renderElement` |
| `apps/cli` | `src/tests/`，统一经 `cliHarness.ts` 注入 `fetch`、文件与 kubectl 替身 | 不打补丁、不碰全局 |
| `apps/cs-*`、`apps/mcp-*` | 没有用例，也不该有逻辑 | 进程入口只做装配，由实机层兜底（§8.3） |
| `runtimes/task` | 生命周期与协议在 `tests/`，纯函数就近 | 两条原生 CLI 验收用例只在任务镜像里跑 |
| `integrations/*`、`templates/*` | 各自 `src/` 内就近 | 独立项目，不 import 工作区包；由根 `bun test` 一并收进来 |
| `deploy/local` | 脚本旁的 `*.test.ts` | 用假 `kubectl`／`curl` 跑真实脚本 |
| `tools/<name>` | `tests/` | 规则的负向夹具用 JSON 存（`tools/arch/tests/fixtures/`），不要写成真实的 `.ts` |
| 仓库根 `tests/` | 只放**跨单元**的用例层：`contracts`、`e2e`、`security`、`scale`、`upgrade`、`architecture` | 一层一个目录；清单之外的目录与散放文件由 `test-discipline` 规则阻断 |

判据：一个用例只需要一个单元就能跑，它就属于那个单元；要同时拉起多个进程或打真实部署，才进仓库根 `tests/`。

命名：文件名即被测概念（`switchTraffic.test.ts`、`trafficConfirmation.test.ts`），不按「part1／part2」拆；
用例标题写**可观察的行为**的完整句子，不写函数名。用例文件上限 1000 行，超了按概念拆。

## 4. 改什么，必须带什么用例

没有「先实现、之后补」这一档；下面每一行都是同一笔提交里的东西。

| 改动 | 必带的用例 | 放哪 |
|---|---|---|
| 新的领域规则、状态机、判定 | 正向、边界、每条拒绝分支；先抽成纯函数 | 源码旁 `domain/x.test.ts` |
| 新用例（`application/`） | 真实数据库上的成功路径；每个前置条件不满足时的拒绝；并发敏感的要有并发用例 | `modules/<name>/tests/` |
| 新 HTTP 路由 | **成功路径**（关掉功能它必须变红）、未登录 401、越权 403／404、校验失败 400 | `modules/<name>/tests/` |
| 新的或改动的契约 Schema | 正向解析、`strict` 拒绝未知键、默认值；属于业务契约面的还要更新金样（§6） | `packages/contracts/` |
| 业务以服务身份调用的路由 | 更新所属模块的 API 面锁；模板或接入容器也调用它时，让它们**自己的客户端代码**打真实路由 | 参照 `modules/business-task/tests/serviceRouteSurface.test.ts` |
| 新迁移 | `bun run migrations:lock`；搬数据的迁移要有「旧库升级」用例（先跑到上一个迁移、灌数据、再升级） | 参照 `modules/dev-session/tests/isolatedNativeActivity.test.ts` |
| 新的后台工作器、对账循环 | 一次 `runOnce` 的效果、失败后的重试与补偿、重复执行的幂等 | `modules/<name>/tests/` |
| 新的工作台页面或组件 | 载入、空、错、成功四态与主要交互；新文案中英文都要有（`i18nParity.test.ts` 会比对键） | `apps/console/src/tests/` |
| 新的平台能力页 | 在 `tests/e2e/platformCapabilities.test.ts` 的能力表里加一行 | `tests/e2e/` |
| 新 CLI 命令 | 经 `cliHarness` 的成功与失败输出、退出码 | `apps/cli/src/tests/` |
| TaskRunner 的新能力、新协议帧 | 协议帧的契约用例；`fakeSession` 上的收发与重连 | `packages/contracts/taskrunner/`、`runtimes/task/tests/` |
| 新 MCP 工具或资源 | `fakePlatform` 上的调用；工具名与资源清单的断言 | `packages/mcp-server/tests/` |
| 新的结构规则 | JSON 负向夹具里每种违规各种一例；真实仓库零违规 | `tools/arch/tests/` |
| bug 修复 | **先写出稳定复现的红用例，再修**；断言上方一句话写明锁的是哪个真实故障 | 故障所在的那一层 |
| 关闭或收缩既有能力（开发规则 §5.5） | 每条禁用、拒绝分支一条用例 | 同上 |
| 重构 | 不新增也不放宽断言；删掉或改名的用例会出现在 CI 摘要里，要在提交说明里说清 | — |

只有这几类不带用例：纯文档与注释、依赖版本号 bump、CI 配置微调、格式化（开发规则 §4）。

## 5. 环境能力与跳过

依赖外部环境的用例在环境缺席时跳过，这在开发机上是对的。规则只有四条：

1. **跳过条件必须来自一次真实的环境探测**，经 `@crewstation/testkit` 的能力闸门给出：`testDatabaseAvailable()`，或 `resolveCapability(能力, 是否可用, 原因)`。探测要校验回来的东西对不对，不要只看「没抛异常」（`dev-gotchas.md` 的 `HTTP_PROXY` 一条）。
2. **跳过时打一行告警**，写明缺的是什么。闸门已经替你打了。
3. **`CS_TEST_REQUIRE` 点名的能力不允许缺席**：逗号分隔，现有 `database`、`gitlab`、`e2e`。被点名而探测失败时闸门抛错，用例文件在加载期就红。写错能力名同样报错。
4. **禁止** `.only`、无条件 `.skip`、`.todo`、`.failing`、恒真的 `skipIf`、用例重试（`retry:`）。由 `tools/arch` 的 `test-discipline` 规则阻断，覆盖工作区、`tests/`、`integrations/`、`templates/` 与 `deploy/`。

CI 的 `check` 作业设 `CS_TEST_REQUIRE=database`，`e2e` 作业设 `CS_TEST_REQUIRE=e2e`：那两样东西是作业自己装的，缺了就是故障。
仓库根 `tests/` 不是工作区单元，按相对路径引用 `packages/testkit/capability.ts`（该文件零依赖，为此而设）。

新增一种环境能力：在 `packages/testkit/capability.ts` 的 `TEST_CAPABILITIES` 里加名字，在用例里用 `resolveCapability` 接上探测，并在本节与 §8 写明哪个作业提供它。

## 6. 业务契约面金样

**范围**：已部署的数字人、接入容器与业务仓库的 `crewstation.yaml` 依赖、而平台单方面改动就会弄坏它们的那部分契约——
`convention.ts` 的全部常量组（身份头、环境变量、路径、令牌声明、域名模式、平台服务主机）、事件推送头、TaskRunner 协议号，
以及 `Manifest`、`ProducedEvent`、`EventDelivery`、业务任务五个请求与响应 Schema 的 JSON Schema 形状。
工作台、CLI 与 MCP 自己消费的接口随平台一起发布，不在此列（那部分由 `apps/console/src/tests/platformSurface.test.ts` 对账）。

**机制**：`packages/contracts/tests/surfaceLock.test.ts` 把当前契约面与 `tests/golden/contractSurface.json` 比较，不一致即红，并把变化分成两类：

| 类别 | 例子 | 怎么过 |
|---|---|---|
| 纯新增 | 新常量；业务可发的新可选字段；平台多接受一种取值；给业务多返回一个字段 | `bun run contracts:lock`，金样与契约改动同一笔提交 |
| 破坏性 | 删、改名、改值；新增必填；收紧长度与格式；由宽松改成 `strict`；让业务收到新的状态值、新的联合分支或 `null` | 先有作者批准的依据（RFC 的能力影响清单或裁定编号，开发规则 §5.5），再 `bun run contracts:lock --breaking "<依据>"`；依据、日期与逐条变化永久留在金样的 `breakingChanges` 里 |

没有依据的破坏性变更，命令拒绝执行且不写文件。不要手改金样。
分类器宁严勿松：放宽约束、调换联合分支顺序这类改动也会被归为破坏性，给出依据即可。
金样只记录 JSON Schema 表达得出的形状；`refine`／`superRefine` 里的规则它看不见，仍由各 Schema 自己的行为用例负责。

**旁路的两把锁**：

- `packages/contracts/tests/conventionMirrors.test.ts`：模板与两个接入容器里手抄的 `x-cs-*` 头名、`CS_*` 环境变量名必须出自约定表，手抄的 traceId 格式必须与平台一致。
- `modules/business-task/tests/serviceRouteSurface.test.ts`：业务任务的服务域路由清单；并让最小样例**自己的**对话客户端原样跑通真实路由与真实请求 Schema。`modules/capabilities/tests/businessTaskApiTable.test.ts` 保证能力说明里那张 API 表的每一条都真实存在。

## 7. 迁移锁

迁移只增不改。运行器（`packages/persistence/migrations.ts`）只在**已应用过**的库上才发现文件被改，而 CI 的库每次都是空的。
`tools/arch/migrations.lock.json` 记录每个迁移文件的 sha256（取法与运行器一致，即 `platform_infra.migrations.checksum` 里的值），
`tools/arch` 的 `migration-lock` 规则在门禁第一步比对：

| 情形 | 结果 |
|---|---|
| 已入锁的迁移内容变了 | 阻断。要改就新增一个迁移 |
| 已入锁的迁移被删除或改名 | 阻断 |
| 新迁移的序号不大于同目录已入锁的最大序号 | 阻断。插队会让新装与升级的执行顺序不一致 |
| 新迁移尚未入锁 | 阻断，运行 `bun run migrations:lock` 并把锁文件一起提交 |

`bun run migrations:lock` **只追加**：存在前三种情形时它拒绝执行、一个字节都不写。确需改写已入锁的迁移（例如发行前合并迁移）时手工编辑锁文件，并在提交说明里写清原因。
`modules/platform/tests/migrationCoverage.test.ts` 另外保证：磁盘上的每个迁移都在平台的迁移清单里，并能按层序在空库上一次应用成功——新模块建了迁移却忘了加进 `modules/platform/wiring.ts` 时，它会红。

## 8. CI 执行体系

`.github/workflows/ci.yml`，`push` 到 `main`、任何 PR 与手动触发时运行。主干开发下每个推送的 SHA 各自跑完，互不取消。

### 8.1 两个作业

| 作业 | 内容 | 典型耗时 | 阻断条件 |
|---|---|---|---|
| `check` | `bun run check:ci`（`arch:check` → lint → 两次类型检查 → 全部用例，真实 PostgreSQL 17）→ 工作台构建 → 用例报告 → **新增代码防护** → 上传 `junit.xml`／`lcov.info` | 约 3 分钟 | 任一步失败；数据库不可达；新增代码防护未通过 |
| `e2e` | kind 建集群 → `bootstrap.sh` → `install-platform.sh` → 无头 Chrome → `bun test tests/e2e/` → 用例报告 → 上传 `junit.xml`；失败时打印集群诊断 | 约 6 分钟 | 任一步失败；网关、浏览器或管理员登录不可用 |

本机跑 `bun run check`，CI 跑 `bun run check:ci`：两者共用同一段 `check:static` 与同一批用例，`check:ci` 只多出 lcov 与 JUnit 两个报告参数，
把 `lcov.info` 与 `junit.xml` 写到 `coverage/`（已 gitignore），报告与闸门读的就是这两个文件。`tools/testguard` 里有一条用例锁住「两条脚本只差报告参数」。
覆盖率没有在 `bunfig.toml` 里常开，是因为实测 Bun 每次覆盖 `lcov.info` 都会留下一个 `.lcov.info.*.tmp`（全量一次约 500 KB），
而且任何一次单文件运行都会冲掉全量结果。

### 8.2 作业摘要怎么看

每次运行的 Summary 页有四节：用例执行（总数、按区域、失败、**逐条列出的跳过**、最慢的 10 条）、行覆盖率汇总、新增代码防护、本次改动删除或改名的用例。
跳过清单里的每一条都是这次运行没有提供的防护，原因应当都能在 §10 找到；出现解释不了的跳过就是问题。
覆盖率汇总只是信息，不设存量门槛。

### 8.3 新增代码防护

`tools/testguard` 对本次推送的 `before..after`（PR 取目标分支）做 diff，只看改动的行，因此不需要任何存量基线：

1. **改到的生产文件必须被至少一个用例加载。** 有可执行逻辑、却不在覆盖率里的文件直接判违规（否则一个没有用例的新文件会以「0／0」蒙混过关）。
2. **改动的可执行行被用例执行到的比例不低于 80%**（`tools/testguard/policy.ts` 的 `PATCH_LINE_COVERAGE_MIN`；改数字走 ADR）。

范围是 `apps`、`modules`、`packages`、`runtimes`、`tools`、`integrations`、`templates` 下的 `.ts`／`.tsx`，不含用例、`generated/`、类型声明、纯类型文件与只做转发的桶文件。
**进程入口不在范围内**：`main.ts(x)`、`serve.ts`、`*.config.*`，以及根 `package.json` 的 `scripts` 里点名的脚本文件。它们只做装配与启动，由实机层兜底——所以**逻辑不许写在入口里**，写了就等于绕过了这道闸。
只有用真实外部系统才能执行到的代码，先考虑用替身补一条用例；确实不行时在 ADR 里写带期限的例外：`- exception: patch-coverage <路径或 glob> until <YYYY-MM-DD>`（格式见 `docs/adr/README.md`）。

闸门在推送之后才跑，所以红了按开发规则 §3 处理：立刻补用例，或 revert 自己那笔。
本机有数据库时可以提前看：先 `bun run test:cover` 跑一遍全量，再 `bun run test:patch --base origin/main`。
加 `--worktree` 把未提交的改动算进去——共享工作树上会连别人的在制改动一起算，而且 git 的 diff 看不见未追踪的新文件，要先 `git add` 自己的文件。

### 8.4 分支保护

本仓主干开发、直接推送，GitHub 的「必过检查」挡不住 push，只对 PR 生效。防护靠的是：推之前本机跑绿，推之后按自己的 SHA 盯到绿。

## 9. 编写要求

- **断言可观察的行为**，不断言实现细节；**关掉功能，用例必须变红**。新用例写完把 bug 种回去确认它真的红过一次，再删掉（`dev-gotchas.md`「只测失败分支等于没测」）。
- **回归用例写明来历**：断言上方一句话说清它锁的是哪个真实故障、哪一天撞上的。未来的重构把它变红时，读的人要能立刻看出意图。
- **首选可断言面**：抽出纯函数再测，而不是去构造难以构造的运行时对象。
- **夹具先过契约 Schema**（`BusinessTaskDtoSchema.parse({...})`）：夹具写错应当错在夹具上，而不是错在后面的断言上。
- **替身在落空时大声报错**：没配的路由回 404 并带上路径，没配的 kubectl 调用非零退出并说明（`cliHarness.ts`）；不要返回 `undefined` 让用例「碰巧通过」。
- **不重试、不放宽超时来掩盖偶发失败。** 偶发先当真 bug 查（开发规则 §4 的 `runnerLifecycle` 一例修的是产品）。
- **一个文件内的用例可以是有序场景**：模块集成用例在 `beforeAll` 建一个库，后面的用例接着前面的状态推进。因此**不要**对全仓开 `bun test --randomize`——2026-09-20 实测随机序下约 100 条失败，全部是这种有意的顺序依赖，不是缺陷。文件之间必须互不依赖：每个文件自己建库、自己清理。
- **副作用用专属资源与唯一标识**：每个文件一个临时数据库（`createTestDatabase`），GitLab 上一个随机 slug 的项目并在结束时删除；清理只针对本用例新建的东西（Plan §10.1）。
- **工作台渲染用例**：`import './domSetup'` 必须是第一条 import；网络一律经 `globalThis.fetch` 桩并在 `afterEach` 复原，桩要记录每次调用与写操作，并把 503、403、格式不合、永不返回做成开关；在仓库根运行（`apps/console` 下没有 CSS Module 预加载）。
- **实机用例**：不写死环境里的 ID，每一步都要求控制台无报错，权限退化要显式排除——完整约定见 `tests/e2e/README.md`。
- 用例同样受结构规则约束：禁用文件名、禁默认导出、只 import 声明过的依赖；用例文件 1000 行上限。

## 10. 已知的防护缺口

写在这里的每一条都是「CI 是绿的，但这部分没有被证明」。补上一条就从这里删掉。

| 缺口 | 影响 | 现在靠什么 |
|---|---|---|
| CI 里没有 GitLab | `modules/scm` 的 5 条真实 GitLab 集成用例，以及 e2e 里的项目空间用例（CI 运行 35497825404 里是 11 条：项目概览、发布与上线、运行与诊断、项目设置、成员及其布局）在 CI 永远跳过；开通链、标签发布、切流在 CI 没有实机证明 | 本机集群与 `aw-local-gitlab`；待作者裁定，见 `implementation-open-questions.md` I20 |
| e2e 作业不装任务容器镜像（`CS_SKIP_TASK_RUNTIME=1`） | 开发会话、TaskRunner 连接、业务子任务在 CI 没有实机证明 | 本机实机验收；模块与 `runtimes/task` 的集成用例 |
| 两个原生 Agent CLI 的验收用例 | 只在 Linux 任务镜像里、设 `CS_NATIVE_ACTIVITY_ACCEPTANCE=1` 才跑 | 按 RFC-003 的 `native-activity-evidence.md` 手工执行 |
| 真实集群的 k8s 客户端用例 | 需要 `CS_TEST_K8S=1` | 本机；其余用假客户端 |
| e2e 的非管理员身份用例 | 需要 `CS_E2E_VISITOR_*`，CI 没有第二个身份 | 本机 |
| 故障与升级、安全、规模三层 | 尚未建立（Plan M4–M6） | — |
| 删除用例只报告、不阻断 | 重构时删掉一条仍然成立的防护，CI 不会红 | 作业摘要与提交说明 |
| 金样看不见 `refine` 里的规则 | 业务契约上用代码表达的约束被收紧时金样不变 | 各 Schema 自己的行为用例 |

## 11. 命令速查

```
bun run check                       # 门禁：arch:check → lint → typecheck ×2 → 全部用例
bun run check:ci                    # CI 跑的那一条：同上，另把 lcov.info 与 junit.xml 写到 coverage/
bun test path/to/file.test.ts       # 单个文件；必须在仓库根运行
bun run test:cover                  # 全部用例并产出 coverage/（后面可以跟路径，但那样的覆盖率不完整）
bun run test:report                 # 把上一次 test:cover 的结果渲染成 CI 摘要同款的报告
bun run test:patch --base origin/main [--worktree]   # 新增代码防护，本机预演（要先跑过全量 test:cover）
bun run migrations:lock             # 新迁移入锁（只追加）
bun run contracts:lock [--breaking "<依据>"]          # 业务契约面金样入锁
CS_TEST_REQUIRE=database bun test   # 数据库缺席时报错而不是跳过
```
