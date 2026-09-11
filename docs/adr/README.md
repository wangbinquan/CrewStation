# 架构决策记录（ADR）

一个决策一个文件，编号递增，不改写历史：`NNNN-短标题.md`。需要 ADR 的情形见 `docs/engineering/repository-structure.md` §11：新增模块、调整 layer、调整尺寸上限、任何对 `tools/arch` 规则的例外。

## 例外声明格式

`tools/arch` 会读取所有 ADR 中符合下面格式的行，过期后自动失效并重新报错：

```text
- exception: <规则名> <相对仓库根的路径或 glob> until <YYYY-MM-DD>
```

规则名取 `tools/arch/rules/*` 输出的 `rule` 字段，例如 `size-limit`、`dependency-direction`。

## 模板

```markdown
# NNNN. 标题

- 状态：提议｜已接受｜已废弃（被 NNNN 取代）
- 日期：YYYY-MM-DD

## 背景
## 决策
## 后果
## 例外（可选）
```
