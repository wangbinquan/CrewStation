# RFC-018｜实施与验证

状态：Draft · 2026-09-22。等待作者批准 proposal §5 的能力影响清单并裁定 §4 的 Q1／Q2；批准前不改代码（开发规则 §5.3）。

## 任务

| 任务 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| RFC-018-T1 | ADR-0008 模块退役：删目录、手工退出锁条目、schema 处理、依赖边删除 | 批准 | ADR 状态 已接受 |
| RFC-018-T2 | 网络策略：k8s 对象、`ensureNamespace` 分支、启动重下发工作器、保留资源清单 | Q1 | EG-03 |
| RFC-018-T3 | 删除 `modules/egress`、组合根装配、两处依赖声明、四条锁条目 | T2 | EG-02、EG-06 |
| RFC-018-T4 | 契约与 api-client 删除，`AlertTypeSchema` 收缩 | T3 | EG-02 |
| RFC-018-T5 | 工作台：页面、页签、待办、导航、搜索、i18n、重定向与归一，用例与夹具 | T4 | EG-01 |
| RFC-018-T6 | 安装器：配置字段、预检、初始化与用例 | T4 | EG-05 |
| RFC-018-T7 | 参考代理直连上游；本机按标签发布新版 | T2 | EG-04 |
| RFC-018-T8 | 文档回填：基线 v0.3.7、tech-evaluation、仓库结构 v0.5、I9、dev-gotchas、集成与模板文档、e2e 清单、RFC-003 附件标注 | T1–T7 | EG-07 |
| RFC-018-T9 | 门禁、本机部署、实机验收、精确 SHA CI、STATE | T1–T8 | EG-06 |

## 本机部署顺序

1. `bun run check` 通过后构建控制面与工作台镜像并滚动更新；本次没有新增迁移（Q2 选 b 时另有手工 SQL）。
2. 控制面启动后逐项目命名空间核对 NetworkPolicy 集合：方案 C 下接入容器项目多一条 `crewstation-integration-egress`、数字人项目不变；方案 A 下默认策略出向为空规则、任务与构建两条已删除。
3. 发布参考代理新版本（平台标签发布），从开发容器经网关发一次真实 `GET`，期望 200；代理日志无 `/internal/egress/http`。
4. Q2 选 b 时：停写备份 → 两条 SQL → 记录行数与备份位置。
5. e2e 层复跑；STATE 接力段写明镜像标签、命名空间核对结果与代理版本。

## 共享工作树注意

- 只按显式路径暂存与提交；删除目录用 `git rm -r modules/egress`。
- 锁文件的四条删除是手工编辑，提交说明注明「按 testing.md §7 退出已删除模块的迁移」；不要运行不带路径的 `bun run migrations:lock`。
- `proposal/rfc/RFC-003-workbench-ux-redesign/design.md` 当前有其他会话的未提交改动，本 RFC 不碰它；对 RFC-003 附件的标注只改 `proxy-egress.md`。

## 验收清单

| 编号 | 状态 | 证据 |
|---|---|---|
| EG-01 | 未执行 | — |
| EG-02 | 未执行 | — |
| EG-03 | 未执行 | — |
| EG-04 | 未执行 | — |
| EG-05 | 未执行 | — |
| EG-06 | 未执行 | — |
| EG-07 | 未执行 | — |
