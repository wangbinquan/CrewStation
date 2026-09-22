# RFC-018｜实施与验证

状态：In Progress · 2026-09-22。作者已批准 proposal §5 的八项能力影响清单，并裁定 Q1＝C（只给接入容器项目放开服务槽出向）、Q2＝b（本次即清理 `egress` schema 与四行迁移记录，先做停写备份）。

## 任务

| 任务 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| RFC-018-T1 | ADR-0008 模块退役：删目录、手工退出锁条目、schema 清理、依赖边删除 | — | ADR 状态 已接受 |
| RFC-018-T2 | 网络策略（方案 C）：k8s 对象、`ensureNamespace` 按项目 kind 分支、启动重下发工作器、保留资源清单 | — | EG-03 |
| RFC-018-T3 | 删除 `modules/egress`、组合根装配、两处依赖声明、四条锁条目 | T2 | EG-02、EG-06 |
| RFC-018-T4 | 契约与 api-client 删除，`AlertTypeSchema` 收缩 | T3 | EG-02 |
| RFC-018-T5 | 工作台：页面、页签、待办、导航、搜索、i18n、重定向与归一，用例与夹具 | T4 | EG-01 |
| RFC-018-T6 | 安装器：配置字段、预检、初始化与用例 | T4 | EG-05 |
| RFC-018-T7 | 参考代理直连上游；本机按标签发布新版 | T2 | EG-04 |
| RFC-018-T8 | 文档回填：基线 v0.3.7、tech-evaluation、仓库结构 v0.5、I9、dev-gotchas、集成与模板文档、e2e 清单、RFC-003 附件标注 | T1–T7 | EG-07 |
| RFC-018-T9 | 门禁、本机部署、历史数据清理、实机验收、精确 SHA CI、STATE | T1–T8 | EG-06、EG-08 |

## 本机部署顺序

1. `bun run check` 通过后构建控制面与工作台镜像并滚动更新。本次没有新增迁移文件，只有第 4 步的手工 SQL。
2. 控制面启动后逐项目命名空间核对 NetworkPolicy 集合：接入容器项目多一条 `crewstation-integration-egress`，数字人项目不变。
3. 发布参考代理新版本（平台标签发布），从开发容器经网关发一次真实 `GET`，期望 200；代理日志无 `/internal/egress/http`。
4. 历史数据清理，顺序不可调换：停写备份并校验 → `DROP SCHEMA egress CASCADE` → `DELETE FROM platform_infra.migrations WHERE module = 'egress'` → 核对 `egress-blocked` 告警行 → `\dn` 与迁移表复查 → 平台重启确认就绪。记录备份路径、各步行数。
5. e2e 层复跑；STATE 接力段写明镜像标签、命名空间核对结果、代理版本与清理证据。

## 共享工作树注意

- 只按显式路径暂存与提交；删除目录用 `git rm -r modules/egress`。
- 锁文件的四条删除是手工编辑，提交说明注明「按 testing.md §7 退出已删除模块的迁移」；不要运行不带路径的 `bun run migrations:lock`。
- 对 RFC-003 的标注只改 `proxy-egress.md`，不碰其 `design.md`。

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
| EG-08 | 未执行 | — |
