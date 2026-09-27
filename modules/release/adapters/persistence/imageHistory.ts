import type { RuntimeImageHistoryItem, RuntimeImageHistoryRead } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { releases } from './tables';

/** Only the service image actually pinned for this release, never its allowed task image configuration. */
export function releaseImageHistory(db: Executor) {
  return async (input: RuntimeImageHistoryRead): Promise<RuntimeImageHistoryItem[]> => {
    if (!input.versionIds.length) return [];
    const version = sql<string>`${releases.pipeline}->'runtimeImage'->>'versionId'`;
    const rows = await db.select({ id: releases.id, projectId: releases.projectId, serviceId: releases.serviceId,
      versionId: version, name: releases.tag, state: releases.status, message: releases.message,
      createdAt: releases.createdAt, updatedAt: releases.updatedAt,
    }).from(releases).where(and(input.projectId ? eq(releases.projectId, input.projectId) : undefined, inArray(version, input.versionIds),
      input.before ? lt(releases.id, input.before) : undefined,
    )).orderBy(desc(releases.id)).limit(input.limit);
    return rows.map((row) => ({ ...row, kind: 'service', message: row.message ?? undefined,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }));
  };
}
