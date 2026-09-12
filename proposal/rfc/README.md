# RFC 索引

> `proposal/` 下的三件套（Proposal、Design、Plan）是**基线**，描述整个系统。
> 基线之后的新功能、非平凡重构、产品行为变更，一律先走 RFC 再写代码。
> 流程见 `docs/engineering/development-rules.md` §5。

## 登记格式（硬约定）

新 RFC 一律**追加为下面这张表的一行**，编号升序，三列：

```
| [RFC-NNN](./RFC-NNN-{slug}/proposal.md) | 标题：一句话摘要 | 状态 |
```

状态取 `Draft` / `In Progress` / `Done` / `Superseded` 四选一**打头**，其后接日期与证据（commit / CI run）。

两条注意：

1. 正文里的 `|` 必须转义成 `\|`，否则整行错列。
2. **不要在表外另起散文条目**——散在正文里的登记会让「哪些 RFC 没收口」无法一次扫出。

## 目录结构

每个 RFC 一个目录，三个文件，与基线三件套同构：

```text
proposal/rfc/RFC-NNN-{slug}/
├─ proposal.md   # 产品视角：背景、目标与非目标、用户故事、验收标准
├─ design.md     # 技术设计：接口契约、数据流、落在哪个模块哪一层、失败模式、测试策略
└─ plan.md       # 任务分解：RFC-NNN-T1… 、依赖、验收清单
```

编号从 `RFC-001` 起递增，**不复用、不重排**。被取代的 RFC 保留原目录，状态改 `Superseded` 并写明取代它的编号。

## 索引

| 编号 | 标题 | 状态 |
|---|---|---|
| — | 尚无 RFC。基线三件套（`../proposal.md`、`../design.md`、`../plan.md`，v0.3.3）仍覆盖当前全部范围。 | — |
