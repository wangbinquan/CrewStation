// RFC-034 v2 §4 —— 一次有界的只读聚合，读 OpenCode 原生存储里的 step-finish 用量。
// 只读数字字段与 assistant message 的 providerID/modelID，不读提示词、输出或工具内容。
// 依据（opencode 源码）：`packages/core/src/session/sql.ts:22-98` 的 session(parent_id) / message /
// part 三表与 `Timestamps`（time_created / time_updated 为 ms epoch）；`packages/opencode/src/session/
// processor.ts:435-455` 在 step-finish part 上写 tokens；`session.ts:338-374` 的 `getUsage` 把推理从
// output 中扣除，所以这里把推理加回输出一次。与 agent-workflow `services/runtime/opencode/nativeUsage.ts` 同一查询。

import { Database } from 'bun:sqlite';
import { isAbsolute, join } from 'node:path';
import type { AgentUsageModel } from '@crewstation/contracts';
import { tokenCount } from './meter';

/** 汇总沿 parent_id 向下的委派深度。 */
export const OPENCODE_TREE_MAX_DEPTH = 8;
/** 会话树超过这个规模就不汇总（保留流上的视图）。 */
export const OPENCODE_TREE_MAX_SESSIONS = 500;

/**
 * 与 OpenCode 定位自己存储的规则一致：绝对的 `OPENCODE_DB`，否则数据目录
 * （`XDG_DATA_HOME` 或 `$HOME/.local/share`）下的 `opencode/<OPENCODE_DB|opencode.db>`
 * （opencode `packages/core/src/database/database.ts:42-54`、`packages/core/src/global.ts:3-11`；
 * 发布通道 latest/beta/prod 用 opencode.db，镜像内置的正式版即此）。
 * `:memory:` 与无法定位的相对路径返回 null 而不是猜一个。
 */
export function opencodeUsageDatabasePath(env: Readonly<Record<string, string | undefined>>): string | null {
  const explicit = env.OPENCODE_DB;
  if (explicit === ':memory:') return null;
  if (explicit && isAbsolute(explicit)) return explicit;
  const data = env.XDG_DATA_HOME && isAbsolute(env.XDG_DATA_HOME)
    ? env.XDG_DATA_HOME
    : env.HOME && isAbsolute(env.HOME) ? join(env.HOME, '.local', 'share') : null;
  return data ? join(data, 'opencode', explicit || 'opencode.db') : null;
}

interface UsageRow {
  provider: unknown;
  model: unknown;
  input: unknown;
  output: unknown;
  reasoning: unknown;
  cache_read: unknown;
  cache_write: unknown;
  root_steps?: unknown;
}

const SUMS = `json_extract(m.data, '$.providerID') AS provider,
       json_extract(m.data, '$.modelID') AS model,
       sum(json_extract(p.data, '$.tokens.input')) AS input,
       sum(json_extract(p.data, '$.tokens.output')) AS output,
       sum(json_extract(p.data, '$.tokens.reasoning')) AS reasoning,
       sum(json_extract(p.data, '$.tokens.cache.read')) AS cache_read,
       sum(json_extract(p.data, '$.tokens.cache.write')) AS cache_write`;

function modelsOf(rows: readonly UsageRow[]): AgentUsageModel[] {
  return rows
    .map((row) => {
      const provider = typeof row.provider === 'string' ? row.provider : '';
      const model = typeof row.model === 'string' ? row.model : '';
      const reasoning = tokenCount(row.reasoning);
      return {
        model: (model ? (provider ? `${provider}/${model}` : model) : '').slice(0, 300),
        input: tokenCount(row.input),
        cacheRead: tokenCount(row.cache_read),
        cacheWrite: tokenCount(row.cache_write),
        output: tokenCount(row.output) + reasoning,
        reasoning,
      };
    })
    .sort((a, b) => a.model.localeCompare(b.model));
}

function withStore<T>(path: string | null, read: (db: Database) => T | null): T | null {
  if (!path) return null;
  let db: Database | undefined;
  try {
    db = new Database(path, { readonly: true });
    db.query('PRAGMA busy_timeout = 1000').get();
    return read(db);
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* 读失败从不改变 Agent 的结果。 */
    }
  }
}

export interface OpencodeTreeUsage {
  readonly models: AgentUsageModel[];
  /** 根会话自身的 step-finish 数（流上看到的那部分）。 */
  readonly rootSteps: number;
}

/**
 * 统计 `roots` 及其子孙会话中时间不早于 `since` 的 step-finish，按实际模型分组。
 * 时间下界把恢复会话里此前执行已用掉的步骤排除在外。存储不可用或树超界时返回 null。
 */
export function readOpencodeTreeUsage(path: string | null, roots: readonly string[], since: number): OpencodeTreeUsage | null {
  if (roots.length === 0) return null;
  return withStore(path, (db) => {
    const marks = roots.map(() => '?').join(',');
    const tree = `WITH RECURSIVE tree(id, depth) AS (
        SELECT id, 0 FROM session WHERE id IN (${marks})
        UNION
        SELECT s.id, t.depth + 1 FROM session s JOIN tree t ON s.parent_id = t.id
        WHERE t.depth < ${OPENCODE_TREE_MAX_DEPTH}
      )`;
    const size = db.query<{ sessions: number }, string[]>(`${tree} SELECT count(*) AS sessions FROM tree`).get(...roots);
    if (!size || size.sessions > OPENCODE_TREE_MAX_SESSIONS) return null;
    const rows = db.query<UsageRow, (string | number)[]>(`${tree}
      SELECT ${SUMS},
             sum(CASE WHEN p.session_id IN (${marks}) THEN 1 ELSE 0 END) AS root_steps
      FROM part p JOIN message m ON m.id = p.message_id
      WHERE p.session_id IN (SELECT id FROM tree) AND p.time_created >= ?
        AND json_extract(p.data, '$.type') = 'step-finish'
      GROUP BY provider, model`).all(...roots, ...roots, since);
    return { models: modelsOf(rows), rootSteps: rows.reduce((total, row) => total + tokenCount(row.root_steps), 0) };
  });
}

/**
 * 「＋ CLI」终端没有结构化输出：统计这个私有存储里自 `since` 起活跃的全部会话中、
 * 时间不早于 `since` 的 step-finish。先按 session.time_updated 收窄，避免扫全表。
 */
export function readOpencodeStoreUsage(path: string | null, since: number): AgentUsageModel[] | null {
  return withStore(path, (db) => {
    const rows = db.query<UsageRow, [number, number]>(`
      SELECT ${SUMS}
      FROM part p JOIN message m ON m.id = p.message_id
      WHERE p.session_id IN (SELECT id FROM session WHERE time_updated >= ?)
        AND p.time_created >= ?
        AND json_extract(p.data, '$.type') = 'step-finish'
      GROUP BY provider, model`).all(since, since);
    return modelsOf(rows);
  });
}
