# 0001. 仓库结构、模块划分与依赖原则

- 状态：已接受
- 日期：2026-09-11

## 背景

agent-workflow 仓库因为没有在第一行代码前定下模块与依赖原则，形成了单层平铺 172 个文件的 `services/`、8170 行且被 303 处引用的 `db/schema.ts`、7780 行的 `task.ts`，事后只能靠债务清单收敛。统计与分析见 `docs/engineering/repository-structure.md` §0。

## 决策

采用 `docs/engineering/repository-structure.md` v0.2 的全部规则，要点：apps／modules／packages 三类代码；16 个领域模块各自声明 layer 并只向下依赖；模块内部固定模板；模块间只 import 根入口并由 `exports` 强制；每模块一个 PostgreSQL schema，跨模块只存 ID、不建外键；源码文件 600 行、目录 20 个文件、函数 80 行的硬上限；全部规则由 `tools/arch` 与 lint 在 CI 阻断，不设基线清单。作者于 2026-09-11 裁定其中四项开放点（外键、schema、任务模块拆分、尺寸），结果记录在该文 §13。

## 后果

- 每个新文件在创建时必须能说出所属模块与所在层；`bun run scaffold:module` 生成的模板是唯一的模块起点。
- 规则从首个代码提交生效，之后的任何违规都是新引入的，直接修，不登记债务。
- 例外只能通过后续 ADR 声明并带过期日期。
