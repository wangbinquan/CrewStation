import type { TaskId } from '@crewstation/contracts';
import type { Executor } from '@crewstation/persistence';
import { eq, sql } from 'drizzle-orm';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { EnvironmentRepository } from '../../ports/repositories';
import { environments } from './tables';

function malformed(value: unknown, present: unknown, kind: unknown): boolean {
  if (typeof present !== 'boolean') return true;
  if (!present) return kind !== null || value !== null;
  return kind !== 'object' || value === null || typeof value !== 'object' || Array.isArray(value);
}
/** SQL NULL is absence; original SQL JSONB type cannot be inferred from a driver's decoded value. */
export function maintenanceEnvironmentReader(db: Executor, map: (row: typeof environments.$inferSelect) => TaskEnvironment): NonNullable<EnvironmentRepository['getMaintenanceView']> {
  return async (id: TaskId) => {
    const row = (await db.select({ environment: environments,
      renderPresent: sql<boolean>`${environments.render} IS NOT NULL`, nativePresent: sql<boolean>`${environments.native} IS NOT NULL`,
      renderKind: sql<string | null>`jsonb_typeof(${environments.render})`, nativeKind: sql<string | null>`jsonb_typeof(${environments.native})`,
    }).from(environments).where(eq(environments.id, id)))[0];
    if (!row) return undefined;
    if (malformed(row.environment.render, row.renderPresent, row.renderKind) || malformed(row.environment.native, row.nativePresent, row.nativeKind)) return { status: 'malformed' };
    return { status: 'present', environment: map(row.environment) };
  };
}
