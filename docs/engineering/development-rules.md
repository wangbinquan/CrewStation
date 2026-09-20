# 开发规则

> 状态：生效中（2026-09-12 确立）
> 版本：0.1 · 日期：2026-09-12
> 适用范围：本仓的全部改动，人写的与 Agent 写的一视同仁
> 参考：`~/dev/proj/agent-workflow` 的同类规则（只读借鉴，本文按 CrewStation 的实际情况重写，未照抄）

本文管「怎么改」。管「改成什么形状」的是 `repository-structure.md`；管「为什么这么定」的是 `../adr/`。
三者冲突时，以本文对流程的规定、结构文档对形状的规定、ADR 对决策的规定各自为准。

## 目录

- [1. 主干开发](#1-主干开发)
- [2. 提交纪律](#2-提交纪律)
- [3. 门禁](#3-门禁)
- [4. 改动必须自带测试](#4-改动必须自带测试)
- [5. RFC 机制](#5-rfc-机制)
- [6. RFC 与 ADR 的分工](#6-rfc-与-adr-的分工)
- [7. 工作台界面一致性](#7-工作台界面一致性)
- [8. 先澄清，再动手](#8-先澄清再动手)
- [9. 知识沉淀进仓库](#9-知识沉淀进仓库)
- [10. 提交署名](#10-提交署名)

## 1. 主干开发

**只在 `main` 上开发。不建分支、不用 worktree、不用 stash。** 四条一起生效，缺一条就退回被禁止的形态：

1. **不建任何分支**，不开 PR 走流程。改完直接在 `main` 上提交并推送。
2. **不用 `git worktree`**（开发用途）。不许为了「跑一次干净门禁」或「做对照实验」切出只含自己改动的树。
3. **不用 `git stash`**，包括 `git stash -u`、`git pull --rebase` 的 `rebase.autoStash`、以及 `stash push -- <path>` 的部分暂存。
4. **本地 `main` 不得落后于 `origin/main`**。推完 `git fetch` 确认 `git rev-parse HEAD == git rev-parse origin/main`。

**为什么不建分支。** CI 只在 `push to main` 与 `PR to main` 触发，待在分支上等于一次门禁都没跑；`main` 持续前进，分支越久冲突面越大；多 session 并发时分支切换会把别人的提交顺走。

**工作树是脏的时候怎么同步**（没有 stash 可用）：

```
git add <只加自己的文件> && git commit -- <自己的路径…>   # 先把自己的工作固化
git fetch origin main
git merge --ff-only origin/main          # 无本地提交时；脏树也能过
git merge origin/main                    # 本地已有提交且远端前进时；用 merge，不要 rebase
git push origin main
```

脏树上 `git rebase` / `git pull --rebase` 会被 git 直接拒绝（`cannot rebase: You have unstaged changes`），
而它的 `--autostash` 属于被禁的 stash。

**Claude Code 的默认提示是「在默认分支上应先切分支」——本仓显式覆盖该默认，照它做就是违规。**

## 2. 提交纪律

本仓常有多个 session 并发改同一棵工作树。

- **只提交自己改过的文件**：按路径精确 `git add <file>`，**不要 `git add .` / `git add -A`**。
- **提交也要带 pathspec**：`git commit -- <你的路径…>`。精确 `git add` **挡不住**这件事——共享工作树的 index 是共用的，别人可能早已 `git add` 过在制品，而裸 `git commit` 提交的是**整个暂存区**。
- **推之前看一眼暂存区**：`git diff --cached --stat`，出现任何你没打算提的路径就停下。
- **绝不删除、绝不回退别人的改动**：包括别人改过的行、新增的文件、共享索引里别人加的条目、`package.json` 与锁文件里别人加的依赖。认不出来源的 hunk 一律先问，不要猜。
- **别人的未追踪文件不要主动 `git add`**，让对方自己提。
- **同一文件混了多人改动可以一起提**：不要为「剥离他人改动」去手工改回原内容，那既危险又留脏。直接提整个文件，commit message 只写自己的范围。
- **commit message 只描述自己的改动**，不替别人写描述。

**已推送的提交不要 reset。** 2026-09-12 实撞：一个子 Agent 看到工作树里出现了它没创建的提交，判断成「harness 自动提交」，执行 `git reset --mixed HEAD~1` 把它撤了——而那笔提交已经推上 `origin/main`，于是本地落后远端、文件全变未追踪。**看到意料之外的提交先 `git log` 与 `git branch -r --contains` 查清来源**；已在远端的提交只能用新提交纠正，不能 reset。

**给子 Agent 派活时要写清谁能提交。** 同上那次事故的根因是任务书只说了「不要提交」，没说「也不要动已有的提交」。

## 3. 门禁

**唯一权威门禁是 GitHub Actions**（`.github/workflows/ci.yml`），在干净 checkout 上跑 `bun run check` 加工作台构建。

```
bun run check   # arch:check → lint → typecheck → typecheck:console → test
```

本地跑的是**同一条命令**，因此本仓与 agent-workflow 不同：**推之前请在本地把它跑绿**。本仓单次全量约一分钟，不存在那边「本地门禁 8–10 分钟、多 session 互相挤占」的问题，没有理由把红推给别人。

- `arch:check` 无基线、无例外清单。加例外要走 ADR，并写成 `docs/adr/` 里的过期行（格式见 `docs/adr/README.md`），到期自动失效。
- 依赖 PostgreSQL 与本机测试 GitLab 的集成用例**在连不上时自行跳过**。因此本机全绿**不等于**集成路径跑过——要确认，看 CI。
- **推完立刻按自己的 sha 查 CI**，盯到绿为止。红了立刻修；一时修不完就 revert 自己那笔，别把红的主干留给下一个人。

## 4. 改动必须自带测试

**任何代码改动落 commit 之前必须带上对应的测试用例。** 没有「先实现、之后补测试」这一档。

- **新功能**：正向、边界、错误路径都要覆盖。RFC 的 `design.md` 里列出哪些 case 必写。
- **bug 修复**：先写一个能稳定复现的用例（红），再写修复（绿）。把「为什么这条测试存在」写进用例的注释里，让未来的重构一旦把它变红能立刻看出意图。本仓的写法是在断言上方用一句话写明它锁的是哪个真实故障，例如 `modules/session/tests/sessionModule.test.ts` 里那条 hello 突发帧的回归。
- **首选可断言面**：抽出纯函数再测，而不是去测难以构造的运行时对象。`controllingTerminalPrefix`、`evaluateServiceCall`、`transition` 都是这么抽出来的。
- **不写测试的极少数例外**：纯文档／注释改动、依赖版本号 bump、CI 配置微调、格式化。**任何触及生产代码或测试代码的改动都没有这个豁免。**
- **flaky 不能掩盖红 case**：间歇性失败先确认是不是真 bug。**绝不允许「重跑就过了」作为通过依据。** 2026-09-12 实撞：`runnerLifecycle` 的 shutdown 用例在满负载下偶红，查下去是产品真的会在 `close()` 紧跟 `process.exit` 时把尾部事件丢在发送队列里——修的是产品，不是测试。

## 5. RFC 机制

`proposal/` 下的三件套（Proposal、Design、Plan）是**基线**，描述整个系统。基线之后的**新功能、非平凡重构、产品行为变更**，一律先走 RFC 再写代码。

### 5.1 落档

在 `proposal/rfc/RFC-NNN-{slug}/` 下建三个文件，与基线三件套同构：

| 文件 | 内容 |
|---|---|
| `proposal.md` | 产品视角：背景、目标与非目标、用户故事、验收标准 |
| `design.md` | 技术设计：接口契约、数据流、落在哪个模块哪一层、与现有模块的耦合点、失败模式、测试策略 |
| `plan.md` | 任务分解：编号子任务（`RFC-NNN-T1…`）、依赖、验收清单 |

### 5.2 编号与登记

编号从 `RFC-001` 起递增，**不复用、不重排**。新 RFC 追加为 `proposal/rfc/README.md` 那张表的一行，编号升序，状态取 `Draft` / `In Progress` / `Done` / `Superseded` 四选一打头。**不要在表外另起散文条目**——那会让「哪些 RFC 没收口」无法一次扫出。

### 5.3 用户确认

RFC 写完必须得到用户批准才能进入实现阶段。**不要边写 RFC 边改代码。**

### 5.4 落位对齐（强制）

写 `design.md` 前先读 `repository-structure.md`，在设计里写明本次改动落在哪个模块、哪一层，新增代码**按结构文档落位**：

- 不要往任何目录横向平铺新的跨模块耦合、facade 或跨模块内部 import。
- 顺手能把触及的存量结构朝目标形状挪一步就挪，并在 `design.md` 里写清「本 RFC 承担哪一步、留下哪些债」。
- 确有偏离（必须绕过某层、必须新增临时 facade）时**逐条列出偏离项与理由并呈用户确认**，不得默默沿用旧形状。

### 5.5 能力收缩型 RFC 的附加门槛

凡以任何理由**关闭或收缩既有能力**（含「新路径不再继承旧路径的能力」）的 RFC：

- `proposal.md` 必须含**能力影响清单**：逐项列出被关闭的能力与受影响的形态，作为 breaking change 呈用户逐项确认。不得以「合理默认」名义静默移除。
- 每条禁用／拒绝分支**必须有测试覆盖**，与正向功能同等对待。

### 5.6 不走 RFC 的例外

拼写与单行 bug 修复、纯重命名、依赖升级、文档增删、测试补充、CI 微调。这些直接改 + 提交。

### 5.7 实现期发现的设计缺口

实现中发现基线没覆盖的设计问题，**不要自行裁定**。记进 `docs/engineering/implementation-open-questions.md`，逐条写现状、为什么是问题、可选做法，等作者裁定后再并入基线或立 RFC。

## 6. RFC 与 ADR 的分工

两套机制不重叠，判据是「改的是什么」：

| | RFC | ADR |
|---|---|---|
| 改的是 | 产品行为、功能、跨模块的技术方案 | 仓库的结构规则本身 |
| 形状 | 目录三件套 | 单文件 |
| 位置 | `proposal/rfc/RFC-NNN-{slug}/` | `docs/adr/NNNN-{slug}.md` |
| 触发 | 新功能、非平凡重构、行为变更 | 新增模块、调整 layer、调整尺寸上限、任何对 `tools/arch` 规则的例外 |
| 谁批 | 用户 | 用户 |

一个 RFC 如果顺带新增了模块，**两样都要**：RFC 说清功能，ADR 说清结构决策（例如 ADR-0003 追认 `provisioning` 与 `platform` 两个模块）。

## 7. 工作台界面一致性

任何新增或改动的工作台界面——按钮、弹窗、表单、列表行、页签、空状态、页面 header——必须**优先复用 `apps/console/src/shared/` 里的既有组件与样式**，禁止为了「快一点」落原生元素、自写 chrome、自写 CSS。

- 动手前先扫一遍 `apps/console/src/shared/ui/` 与 `shared/lib/`：`Card`、`Button`、`Badge`、`DataTable`、`FormField`、`QueryStatus`、`InlineConfirm`、`ActionNote`、`EmptyState`、`PageHeader`、`DefinitionList`、`PageHeader`，以及 `usePollingRefetch`、`useDateText`。**清单以源码为准**，不在本文重复以免过时。
- 现有组件差一两个 prop 时**最小扩展它**（加可选 prop、向后兼容），让所有调用方一起受益；**不要** fork 一份或绕开。
- 卡片直接组合表单、表格、提示与操作时用 `Card stacked`；卡片之外的纵向内容用 `Stack`，同组按钮用 `ActionRow`。卡片的 `padding` 只管外框留白，按钮组的 `gap` 只管组内间隔，内容块之间的间距由父布局承担。
- 真的需要全新一类组件时，按「新增公共组件」对待：放进 `shared/ui/<Name>.tsx`、配同名 CSS module、文案走 `useT()`。初版就要考虑被别人复用的形态。
- 颜色一律走 `app/theme/tokens.css` 的变量，**不写裸色值**。
- **禁止 `alert` / `confirm` / `prompt`**：浏览器模态框会冻住本仓用来调试的浏览器自动化。确认一律用行内 UI（`InlineConfirm`）。
- **判定原则**：犹豫「要不要自己写一个」时，默认答案是「不要」。

2026-09-12 实撞：十个页面由四个并行 Agent 写成，各自被禁止改 `shared/`，同一个东西被抄了三到五份，事后要专门开一轮把 19 份副本收回去。**并行派活时必须指定一个 `shared/` 的所有者**，或者先把公共件建好再派。

## 8. 先澄清，再动手

用户给设计想法时，**先研究仓内既有能力，再反复提问澄清全部细节，绝不自主假设**，然后才落 RFC。

对已有实现的断言（「平台在 X 情况下的行为是 Y」）必须以源码或实跑为准，不靠记忆。写进 RFC 或设计文档时**引用具体 `文件:行号`**，让读者能追溯。跨 session 接手时，若文档里出现对行为的断言，上手前先验证一遍再继续。

借鉴 `~/dev/proj/agent-workflow` 的代码或规则时：**那个仓库是只读的，任何情况下都不许写入**。

## 9. 知识沉淀进仓库

仓库是唯一事实源。个人 memory 只留因人因机而异的配置（本机路径、语言偏好、个人工具链），凡对他人有用的一律落仓：

| 内容 | 去处 |
|---|---|
| 跨 RFC 的通用踩坑与命令级 tips | `docs/engineering/dev-gotchas.md` |
| 实现期发现、待作者裁定的设计问题 | `docs/engineering/implementation-open-questions.md` |
| 强制规则与工作方式约定 | 本文 |
| 仓库结构与依赖规则 | `docs/engineering/repository-structure.md` |
| 结构决策 | `docs/adr/` |
| 单个 RFC 的细节 | 该 RFC 目录 |
| session 之间的接力状态 | `STATE.md` |

一批工作做完就提交、推送，并更新 `STATE.md`，让下一个 session 能直接接上。

## 10. 提交署名

AI 编码 Agent 对一次提交有实质贡献时，追加标准的 Git co-author trailer，用**该 Agent 或模型的真实名字**与其提供方的 noreply 邮箱：

```
Co-Authored-By: <agent-or-model-name> <provider-noreply-email>
```

- 每个有实质贡献的 Agent 一条，不重复。
- **不要**给纯人工提交加 Agent trailer，也不要把提交署给没有实质贡献的 Agent。
- 提交后推送前用 `git show -s --format=%B HEAD` 核一眼；缺了就补一笔改正，**不要为了补署名重写已推送的历史**。
