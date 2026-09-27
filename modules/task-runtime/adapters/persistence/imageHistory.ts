import type { RuntimeImageHistoryItem, RuntimeImageHistoryRead } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { purposeOf } from '../../domain/taskEnvironment';
import { environments } from './tables';

/** Immutable render snapshots survive resource cleanup; references do not describe execution history. */
export function environmentImageHistory(db: Executor) {
  return async (input: RuntimeImageHistoryRead): Promise<RuntimeImageHistoryItem[]> => {
    if (!input.versionIds.length) return [];
    const version = sql<string>`${environments.render}->'runtimeImage'->>'versionId'`;
    const rows = await db.select({ id: environments.id, projectId: environments.projectId, serviceId: environments.serviceId,
      versionId: version, kind: environments.kind, state: environments.state, native: environments.native,
      traceId: environments.traceId, message: environments.message, createdAt: environments.createdAt, updatedAt: environments.updatedAt,
    }).from(environments).where(and(input.projectId ? eq(environments.projectId, input.projectId) : undefined, inArray(version, input.versionIds),
      sql`${environments.kind} <> 'profile-test'`, input.before ? lt(environments.id, input.before) : undefined,
    )).orderBy(desc(environments.id)).limit(input.limit);
    return rows.map((row) => ({ id: row.id, projectId: row.projectId, serviceId: row.serviceId, versionId: row.versionId,
      kind: row.native ? purposeOf(row.native) === 'cli' ? 'cli' : 'agent' : row.kind === 'dev-session' ? 'development' : 'task',
      state: row.state, traceId: row.traceId, ...(row.native ? { parentTaskId: row.native.parentTaskId } : {}),
      ...(row.message ? { message: row.message } : {}), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }));
  };
}
