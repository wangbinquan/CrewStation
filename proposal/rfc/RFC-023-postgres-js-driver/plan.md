# RFC-023｜实施与验证

状态：Draft · 2026-09-23 · 待作者批准。任务全部未执行。

## 任务

| 编号 | 任务 | 依赖 | 状态 |
|---|---|---|---|
| RFC-023-T1 | 写突发复现脚本（设计 §7），在现有 Bun 驱动的本机集群上跑，如实记录复现与否 | 网络插件迁移完成 | 未执行 |
| RFC-023-T2 | `packages/persistence/connection.ts` 换 postgres.js：会话参数、类型、关闭、依赖；`connection.test.ts` 补会话参数、关闭与池内并发三组用例 | — | 未执行 |
| RFC-023-T3 | `packages/testkit/database.ts` 换驱动，全部模块用例在新驱动上跑通 | T2 | 未执行 |
| RFC-023-T4 | 数据模块的 `bunSqlProvider.ts` 改为 `postgresProvider.ts`（`postgresJsProvider`），模块用例覆盖建库、建角色、临时角色 | T2 | 未执行 |
| RFC-023-T5 | 核对直接用 `handle.client` 的三个测试文件；清掉仓库里其余提到 Bun 驱动的地方 | T2–T4 | 未执行 |
| RFC-023-T6 | 导出树全量门禁，提交推送，精确 SHA 的 CI 六项通过 | T2–T5 | 未执行 |
| RFC-023-T7 | 本机部署：七个控制面加迁移 Job。跑 DB-02 到 DB-07，然后开始 24 小时观察（DB-08） | T1、T6 | 未执行 |
| RFC-023-T8 | 文档回填（设计 §9）、I16 关闭、验收记录 `acceptance.md`、STATE.md、登记表置 Done | T7 | 未执行 |

## 本机部署顺序

1. 先通知并行会话，确认没有进行中的滚动与实机核对。
2. 从提交的 SHA 用 `git archive` 构建控制面镜像，导入节点。
3. 其余六个部署 → 观察一分钟 → cs-api → 观察两分钟。迁移 Job 用同一镜像，只确认没有待应用的迁移。
4. 跑突发复现脚本，与 T1 的旧驱动结果对比。
5. 开始 24 小时观察：记下起止时间，以及期间各服务的重启次数与 I16 特征报错的计数。

## 共享工作树注意

- `packages/persistence` 被所有模块依赖。提交前在「HEAD＋本批」的导出树上跑全量门禁，并逐文件对 HEAD 核对只含本 RFC 的改动。
- `bun.lock` 与三个 `package.json` 里只加 `postgres` 一项，不带别人新加的依赖。
- 实施前再向并行会话确认，没有人在改 `packages/persistence`、`packages/testkit/database.ts` 与数据模块的建库适配器（2026-09-23 已问过一次）。

## 验收清单

| 编号 | 对应任务 | 结果 |
|---|---|---|
| DB-01 | T6 | 未执行 |
| DB-02 | T1、T7 | 未执行 |
| DB-03 | T2、T7 | 未执行 |
| DB-04 | T2、T7 | 未执行 |
| DB-05 | T4、T7 | 未执行 |
| DB-06 | T6、T7 | 未执行 |
| DB-07 | T2、T7 | 未执行 |
| DB-08 | T7 | 未执行 |
