# RFC-023｜设计

状态：Draft · 2026-09-23 · 配套[提案](./proposal.md)与[计划](./plan.md)。

## 目录

- [1. 现状证据](#1-现状证据)
- [2. 新的连接层](#2-新的连接层)
- [3. 其他直接用驱动的地方](#3-其他直接用驱动的地方)
- [4. 两个驱动的行为差异](#4-两个驱动的行为差异)
- [5. 落位对齐](#5-落位对齐)
- [6. 失败模式与回退](#6-失败模式与回退)
- [7. 测试策略](#7-测试策略)
- [8. 部署](#8-部署)
- [9. 文档回填](#9-文档回填)

## 1. 现状证据

2026-09-23 在 main 上逐处核对（不含 `node_modules`）：

| 位置 | 用法 |
|---|---|
| `packages/persistence/connection.ts` | 全仓唯一引用 `drizzle-orm/bun-sql` 的地方：`new SQL(withSessionDefaults(url), { max })`，导出 `Database`、`Transaction`、`Executor`、`DatabaseHandle { db, client: SQL, close }` |
| `packages/testkit/database.ts` | 用 Bun `SQL` 建、删测试库：`CREATE DATABASE`，以及 `DROP DATABASE … WITH (FORCE)` |
| `modules/data/adapters/postgres/bunSqlProvider.ts`（65 行） | 用管理员连接和目标库连接为项目建库、建角色、授权、发临时角色、终止会话，全部走 `unsafe()` 加标识符转义 |
| 三个测试文件 | 直接用 `handle.client` 的标签模板写 SQL：`modules/platform/tests/clusterManagement.test.ts`、`modules/release/tests/trafficConfirmation.test.ts`、`modules/release/tests/publishConcurrency.test.ts` |
| 事务 | 非测试代码 28 处 `.transaction(`。其中 `drizzleNativeActivity` 用 Drizzle 的事务配置开可重复读的只读快照，另有 3 处 `pg_advisory_xact_lock` |
| `execute` | 非测试代码 42 处，结果都按数组使用（`as unknown as Array<…>`、`[0]`、`.length`），没有读 `.rows` |
| 数组参数 | 只有 `packages/queue/jobs.ts` 一处，写成 `ANY(ARRAY[${sql.join(…)}]::text[])`，由 Drizzle 展开成逐个参数，与驱动无关 |
| int8 | 原生计数都已转成 `::int`；bigint 列都声明为 `{ mode: 'number' }`，由 Drizzle 映射 |
| 驱动专有错误字段 | 没有按驱动错误的 `code`、`errno` 分支的代码 |

## 2. 新的连接层

`packages/persistence/connection.ts` 改为：

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

export function connectDatabase(url: string, options: { max?: number } = {}): DatabaseHandle {
  const client = postgres(url, { max: options.max ?? 10, connect_timeout: 10, connection: sessionParameters(url) });
  const db = drizzle({ client });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}
```

- **会话默认值**：现在的写法是往连接串补 `options=-c idle_in_transaction_session_timeout=60000`。postgres.js 通过 `connection` 把参数放进启动消息。
  - 改成 `sessionParameters(url)`：连接串已带 `options` 时原样沿用运维的值，否则给出 `{ idle_in_transaction_session_timeout: 60000 }`。
  - postgres.js 对连接串里 `options` 的处理，在 T2 用真实 PostgreSQL 核对（已有用例 `connection.test.ts` 读 `current_setting`），再定是否保留 `withSessionDefaults`。
- **类型**：
  - `Database` 改为 `ReturnType<typeof drizzle>`（postgres-js 版），`Transaction` 与 `Executor` 的推导方式不变。
  - `DatabaseHandle.client` 的类型由 Bun 的 `SQL` 换成 postgres.js 的 `Sql`；标签模板与 `unsafe()` 的用法两者一致。
- **关闭**：`client.end({ timeout: 5 })`。等进行中的查询最多 5 秒，再强制断开，落在终止宽限期之内。
- **依赖**：`postgres` 加进 `packages/persistence`、`packages/testkit` 和 `modules/data` 的 `package.json`，锁定实施当时的版本（2026-09-23 为 3.4.9），`bun.lock` 随之更新。

## 3. 其他直接用驱动的地方

- **测试库**（`packages/testkit/database.ts`）：管理员连接改用 `postgres(baseUrl(), { max: 1 })`，`unsafe()` 照旧。
- **数据模块**：`bunSqlProvider.ts` 改名 `postgresProvider.ts`，工厂 `bunSqlPostgresProvider` 改名 `postgresJsProvider`，`modules/data/wiring.ts` 的两处引用一并改。
  - 管理员连接 `max: 2`，目标库临时连接 `max: 1`，用完 `end()`。
  - 建库、建角色、授权的 SQL 文本不变，标识符与字面量的转义函数不变。
- **三个测试文件**：`handle.client` 的标签模板在 postgres.js 上写法相同，返回的也是行数组。逐个跑通即可，预计不改。

## 4. 两个驱动的行为差异

| 方面 | 处理 |
|---|---|
| `execute` 的结果 | postgres.js 返回行数组（`RowList`），与现在按数组使用的写法一致 |
| int8、numeric | postgres.js 默认把 int8 读成字符串。现有代码没有直接读原生 int8 的地方（§1）。加一条模块级用例锁住：`count(*)` 必须转 `::int` 才按数字用 |
| json／jsonb | 两者都自动解析；Drizzle 的 jsonb 列映射不变 |
| 时间 | timestamptz 都读成 `Date` |
| 预编译语句 | postgres.js 默认每个连接缓存命名的预编译语句。直连 PostgreSQL 没有问题；以后如果前面加事务级连接代理，再设 `prepare: false`（非目标） |
| 事务 | Drizzle 用 `sql.begin` 独占一条连接；嵌套用保存点。隔离级别与只读由 Drizzle 的事务配置下发，和现在一样 |
| 连接建立 | 惰性建立、按需扩到 `max`。新进程刚起来时积压的请求会排队等连接，这正是 DB-02 要压的场景 |

## 5. 落位对齐

- 改动都在已有的位置：`packages/persistence`（无领域包，唯一创建应用连接的地方）、`packages/testkit`、`modules/data/adapters/postgres`。
- 不新增跨模块耦合，不改 `tools/arch/policy.ts`（仓库没有第三方依赖白名单）。
- 没有偏离项。

## 6. 失败模式与回退

| 失败 | 应对 |
|---|---|
| 新驱动也在突发并发下出错 | DB-02、DB-08 会发现。回退到上一版镜像，重新评估 I16 的 (a) |
| 会话参数没生效 | DB-03 的用例在门禁里拦住 |
| 关闭不干净，留下连接 | DB-07 核对；`end` 有 5 秒上限 |
| 某处依赖了 Bun 驱动的隐性行为（例如返回形状） | 全量用例加 e2e 覆盖；§1 的核对表是改动清单 |

回退就是重新部署上一版镜像。本 RFC 不改表结构、不加迁移，数据面没有要回滚的东西。

## 7. 测试策略

- 现有的单元、模块、工作台与 e2e 用例全部在新驱动上跑，不放宽任何断言。
- `packages/persistence/connection.test.ts` 新增：
  - 会话参数：没带 `options` 时为 1min，带了 `options` 时按连接串。
  - 关闭后不再留连接：查 `pg_stat_activity`。
  - 池内并发：同一连接池上同时跑 200 个查询，混着带保存点的事务、咨询锁和先放弃再完成的查询（模拟 `boundedNativeRead` 超时后后台继续跑）。每个结果都要和自己的查询对得上，逐行核对返回的标记值。
- `modules/data` 的模块用例在真实 PostgreSQL 上跑建库、建角色与临时角色。
- **突发复现脚本**：放在 `tests/e2e` 之外的验收目录，只在本机集群上跑，不进 CI。
  - 滚动出一个新的 cs-api 进程，就绪前后用多个登录会话集中请求开发页用到的接口。
  - 记录 5xx、I16 特征报错与探针重启。先在旧驱动上跑，再在新驱动上跑。

## 8. 部署

- 七个控制面部署用同一镜像，一次滚动，迁移 Job 同镜像。
- 按惯例先通知并行会话，再分批滚动：其余六个 → 观察一分钟 → cs-api → 观察两分钟。
- 本机网络插件迁移（kindnet 换成 Calico）完成之前不部署。

## 9. 文档回填

- `proposal/tech-evaluation.md` E04 的确认记录：PostgreSQL 驱动定为 postgres.js，附来源 I16 与本 RFC。
- 基线 Design §3 技术栈表：「元数据与队列」一行写明 Drizzle 经 postgres.js 连接。版本号按当时的最新版本递增。
- I16 在 DB-08 通过后关闭。
- STATE.md 与 RFC 登记表。
