# 0007. 用例防护体系：把「改动自带测试」与「绿等于跑过」机械化

- 状态：实施中（2026-09-20 作者指令「把用例防护体系、GitHub 上的 CI 用例执行体系建立起来」后随即实施；作者尚未逐条复核本 ADR，待复核的取值见文末）
- 日期：2026-09-20
- 关联：规范正文 [`docs/engineering/testing.md`](../engineering/testing.md)；开发规则 §3、§4；结构文档 §1、§10；Plan §10.1

## 背景

2026-09-20 实测本仓有 266 个用例文件、1642 条用例，本机行覆盖率 95.9%。用例不缺，缺的是让它们不会悄悄失效的机制。核对出七个能让门禁「绿着坏掉」的洞（逐条证据在 `testing.md` §0）：

- 数据库不可达时约 60 组集成用例整层 `skipIf` 跳过而 `check` 照绿；`e2e` 作业里登录失败时整套实机用例跳过而作业照绿。
- 「改动必须自带测试」只有文字（开发规则 §4），没有任何机械检查。
- `packages/contracts/convention.ts` 自称「平台任何一侧改名都算破坏性变更」，却没有一条用例锁住它的取值；模板与两个接入容器里的名字是手抄的，与约定表之间没有对账。
- 迁移的不可变性只在已应用过的库上由运行器发现，CI 的库每次都是空的，改旧迁移在 CI 永远是绿的。
- `.only` 在本机静默吃掉同文件的其余用例（Bun 只在 `CI=true` 时拒绝）；跳过与被删除的用例在 CI 上没有任何地方看得见。

这些都不是产品行为，而是仓库自己的结构规则与门禁，因此走 ADR 而不是 RFC。

## 决策

1. **用例分层与落位**沿用 Plan §10.1，工程化展开写在 `testing.md` §2–§4：每种单元的用例放在哪、每类改动必须带哪些用例。仓库根 `tests/` 只放跨单元的用例层，一层一个目录：`contracts`、`e2e`、`security`、`scale`、`upgrade`、`architecture`（与结构文档 §1 原有描述一致，现在由规则阻断）。
2. **`tools/arch` 新增两条规则**，与原有六条一样无基线、无例外清单：
   - `test-discipline`：禁止 `.only`、无条件 `.skip`、`.todo`、`.failing`、恒真的 `skipIf`、用例重试；仓库根 `tests/` 只允许上述用例层目录、不散放文件。扫描范围除工作区外还包括 `tests/`、`integrations/`、`templates/`、`deploy/`。
   - `migration-lock`：`tools/arch/migrations.lock.json` 记录每个迁移的 sha256；已入锁的迁移不可修改、删除，新迁移的序号必须大于同目录已入锁的最大序号，新迁移必须入锁。`bun run migrations:lock` 只追加、不改写。
   - 规则清单收进 `tools/arch/ruleSet.ts`，`check.ts` 与「真实仓库零违规」用例共用一份。
3. **环境能力闸门**：`@crewstation/testkit` 提供 `resolveCapability` 与 `CS_TEST_REQUIRE`（现有能力 `database`、`gitlab`、`e2e`）。被点名的能力缺席时抛错而不是跳过；CI 的 `check` 点名 `database`，`e2e` 点名 `e2e`。`packages/testkit/capability.ts` 保持零依赖，供不是工作区单元的仓库根 `tests/` 按相对路径引用。
4. **业务契约面金样**：`packages/contracts/tests/golden/contractSurface.json` 锁住已部署业务依赖的那部分契约（范围见 `testing.md` §6）。纯新增用 `bun run contracts:lock` 入锁；破坏性变更必须带作者批准的依据（`--breaking "<依据>"`），依据永久留痕。这是开发规则 §5.5「能力收缩要逐项确认」在契约层的机械化。
5. **新增工具单元 `tools/testguard`**：读 `bun test` 产出的 `coverage/junit.xml` 与 `coverage/lcov.info`。
   - **新增代码防护（阻断）**：只看本次推送改动的行——改到的生产文件必须被至少一个用例加载；改动的可执行行被执行到的比例不低于 `PATCH_LINE_COVERAGE_MIN`。不设任何存量覆盖率门槛，因此没有基线。
   - **报告（不阻断）**：用例执行汇总、逐条列出的跳过、覆盖率汇总、本次改动删除或改名的用例，写入 GitHub 作业摘要。
   - 进程入口（`main.ts(x)`、`serve.ts`、`*.config.*`、根 `scripts` 点名的脚本）不在防护范围内，由实机层兜底；因此**逻辑不许写在入口里**。
6. **门禁脚本拆成三段**：`check:static`（四步静态检查）、`check`（`check:static` 加 `bun test`，本机用）、`check:ci`（`check:static` 加 `test:cover`，CI 用）。`check:ci` 只比 `check` 多 lcov 与 JUnit 两个报告参数，由一条用例锁住；开发规则 §3「本机与 CI 同一条命令」的意图不变。没有在 `bunfig.toml` 里常开覆盖率：实测 Bun 每次覆盖 `lcov.info` 都会留下一个 `.tmp` 残留，且单文件运行会冲掉全量结果。
7. **CI**（`.github/workflows/ci.yml`）：`check` 增加 `fetch-depth: 0`、20 分钟超时、用例报告、新增代码防护与产物上传；`e2e` 增加用例报告与产物上传；push 之间互不取消（每个 SHA 都要各自跑完），同一 PR 的旧运行取消。

## 后果

- 门禁从「六条架构规则」变成八条；新增迁移要多跑一条 `bun run migrations:lock`，改业务契约面要多跑一条 `bun run contracts:lock`。两条命令的失败信息都写明了下一步。
- 新增代码防护在推送之后才判定（主干开发，没有 PR 可挡）。红了按开发规则 §3 处理：立刻补用例或 revert 自己那笔。
- 只能用真实外部系统执行到的代码会撞上这道闸。优先用替身补用例；确实不行时用带期限的例外行（规则名 `patch-coverage`，格式见 `docs/adr/README.md`），到期自动失效。
- 模块集成用例在同一文件内是有序场景（共用一个 `beforeAll` 建的库）。2026-09-20 实测 `bun test --randomize` 下约 100 条失败，全部来自这种有意的顺序依赖，因此**不**引入随机序巡检；文件之间的独立性由「每个文件自己建库」保证。
- CI 里没有 GitLab，核心业务链路的实机用例在 CI 仍然跳过。这是最大的遗留缺口，做法待作者裁定，登记为 `implementation-open-questions.md` I20。

## 待作者复核的取值

| 项 | 现取值 | 说明 |
|---|---|---|
| P1 新增代码防护是否阻断 | 阻断 | 依据结构文档 §0 第 3、4 条原则「规则机械化、阻断方式不讨论」；如要先观察一段时间，可把 `ci.yml` 里 `new-code protection` 一步改成 `continue-on-error: true` |
| P2 `PATCH_LINE_COVERAGE_MIN` | 80 | 保守起步；本机实测全仓生产代码为 95.9% |
| P3 业务契约面的范围 | 约定表常量、事件推送头、TaskRunner 协议号、Manifest、事件两个信封、业务任务五个 Schema | TaskRunner 协议帧、网关放行表与 Pod 身份索引属平台内部，未纳入 |
| P4 契约变更分类「宁严勿松」 | 放宽约束、给业务的枚举加值也归为破坏性 | 给出依据即可入锁；代价是偶尔多写一句依据 |
| P5 覆盖率只在 `check:ci`／`test:cover` 里开 | 是 | 常开会在共享工作树里留下残留文件、被单文件运行冲掉；代价是 CI 与本机的脚本名不同（内容由用例锁住只差报告参数） |
| P6 删除用例只报告不阻断 | 只报告 | 合法的删除很常见，阻断会逼出形式主义 |
