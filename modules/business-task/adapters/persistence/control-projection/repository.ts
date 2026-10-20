import { eq, sql } from 'drizzle-orm';
import { bigint, text, timestamp } from 'drizzle-orm/pg-core';
import type { Database, Executor } from '@crewstation/persistence';
import { jsonDocument } from '@crewstation/persistence';
import type { ExecutionControl } from '../../../domain/executionControl';
import { nextEpoch } from '../../../domain/executionControl';
import type { StorageControlOutbox } from '../../../ports/storage/control';
import { sameStorageWriteAuthority, storageControlUpdate, type StorageControlUpdate } from '../../../domain/storageControl';
import { businessTaskSchema } from '../schema';
import { executionControls } from '../executionTables';
import { executionTransaction, readExecutionControl } from '../executionTransaction';
import { businessAdmissionOpen } from '../deletion/admission';

const deliveries = businessTaskSchema.table('storage_control_outbox', {
  serviceId: text('service_id').primaryKey(), version: bigint('version', { mode: 'number' }).notNull(),
  body: jsonDocument('body').$type<StorageControlUpdate>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

/** Must run inside the service's executionTransaction, including migration mutations. */
export async function persistExecutionControl(tx: Executor, value: ExecutionControl, previous: ExecutionControl | undefined, enabled: boolean): Promise<ExecutionControl> {
  let control = value;
  if (enabled || previous?.storageSync) {
    const prior = previous?.storageSync, changed = !prior || JSON.stringify(value) !== JSON.stringify(previous);
    if (changed) {
      const version = nextEpoch(prior?.version ?? 0);
      // A renewal keeps the write authority, so the holder is not fenced while its later deadline is delivered (AW RFC-370, 2026-10-19).
      // A row from before `authorityVersion` is known to storage only when its own version was acknowledged.
      const priorAuthority = prior ? prior.authorityVersion ?? (prior.acknowledgedVersion === prior.version ? prior.version : undefined) : undefined;
      const authorityVersion = priorAuthority !== undefined && sameStorageWriteAuthority(previous!, value) ? priorAuthority : version;
      control = { ...value, storageSync: { version, acknowledgedVersion: prior?.acknowledgedVersion ?? 0, authorityVersion } };
    }
    if (control.storageSync!.version !== control.storageSync!.acknowledgedVersion) {
      const update = storageControlUpdate(control);
      await tx.insert(deliveries).values({ serviceId: control.serviceId, version: update.controlVersion, body: update, updatedAt: sql`clock_timestamp()` })
        .onConflictDoUpdate({ target: deliveries.serviceId, set: { version: update.controlVersion, body: update, updatedAt: sql`clock_timestamp()` } });
    }
  }
  await tx.insert(executionControls).values({ serviceId: control.serviceId, body: control }).onConflictDoUpdate({ target: executionControls.serviceId, set: { body: control } });
  return control;
}

export function storageControlOutbox(db: Database): StorageControlOutbox {
  return {
    pending: async (limit) => (await db.select().from(deliveries).where(businessAdmissionOpen(deliveries.serviceId)).orderBy(deliveries.updatedAt).limit(Math.max(1, Math.min(100, limit)))).map((row) => row.body),
    acknowledge: (update) => executionTransaction(db, update.serviceId, async (tx, now) => {
      const current = await readExecutionControl(tx, update.serviceId);
      if (current?.storageSync?.version !== update.controlVersion) return undefined;
      const control = { ...current, storageSync: { ...current.storageSync, acknowledgedVersion: update.controlVersion } };
      await tx.update(executionControls).set({ body: control }).where(eq(executionControls.serviceId, update.serviceId));
      await tx.delete(deliveries).where(eq(deliveries.serviceId, update.serviceId));
      return { control, now };
    }),
  };
}
