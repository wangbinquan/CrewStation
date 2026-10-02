import type { ProjectDeletionContext, ProjectDeletionInventory } from '@crewstation/contracts';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory, runMigrations } from '@crewstation/persistence';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { TestDatabase } from '@crewstation/testkit';
import { observabilityMigrations } from '../wiring';
import { observabilityDeletionRepository } from '../adapters/persistence/projectDeletion';
import { observabilityDeletionOwner } from '../application/projectDeletion';
import type { ObservabilityDeletionTasks } from '../ports/projectDeletion';

export const target = ProjectDeletionTargetSchema.parse({ id: '01a0bf5d-8f4b-7178-82e1-9a99060b1192', slug: 'demo', name: 'Demo', namespace: 'cs-demo',
  kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.cs.localhost', previewHost: 'preview.demo.cs.localhost', serviceHost: 'demo' });
export const otherId = '01a0bf5d-8f4b-7178-82e1-9a99060b1193';
export async function fixture(legacy = false, tasks?: ObservabilityDeletionTasks) {
  const previous = { ...observabilityMigrations, files: observabilityMigrations.files.filter((file) => file.name.localeCompare('0014_') < 0) };
  const database = await createTestDatabase([legacy ? previous : observabilityMigrations]);
  const operationId = newResourceId(), identities = resourceIdentityDirectory(database.db, () => [observabilityMigrations]);
  const input = { db: database.db, identities, ...(tasks ? { tasks } : {}), assertGrant: async (context: ProjectDeletionContext) => {
    if (context.operationId !== operationId) throw new Error('wrong operation');
  } };
  const repository = observabilityDeletionRepository(input), owner = observabilityDeletionOwner(repository);
  const context = (confirmed: ProjectDeletionInventory, phase: ProjectDeletionContext['phase'], generation = 1): ProjectDeletionContext => ({ operationId, target, confirmed, phase, generation });
  return { database, operationId, input, repository, owner, context, upgrade: () => runMigrations(database.db, [observabilityMigrations]) };
}
export async function insertRow(database: TestDatabase, name: string, body: Record<string, unknown>) {
  const table = sql`${sql.identifier('observability')}.${sql.identifier(name)}`;
  await database.db.execute(sql`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table},${JSON.stringify(body)}::jsonb)`);
}
export async function contentCounts(database: TestDatabase): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const tables = await database.db.execute<{ table_name: string }>(sql`SELECT table_name FROM information_schema.tables WHERE table_schema='observability' ORDER BY table_name`);
  for (const row of tables) result[row.table_name] = Number((await database.db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM ${sql.identifier('observability')}.${sql.identifier(row.table_name)}`))[0]!.count);
  return result;
}
/** Minimal stored documents contain private payloads so cleanup assertions cover content, not only heads. */
export async function seed(database: TestDatabase, projectId: string) {
  const taskId = newResourceId(), executionId = newResourceId(), taskKey = jsonHash({ projectId, taskId }), meterKey = jsonHash(newResourceId()), captureId = jsonHash(newResourceId());
  const identity = { projectId, taskId, executionId }, document = { identity, private: 'private-value:' + projectId };
  const rows: Record<string, Record<string, unknown>> = {
    usage_heads: { task_key: taskKey, project_id: projectId, task_id: taskId, sequence: 3 },
    accepted_execution_prices: { execution_id: executionId, generation: 1, fingerprint: 'price', document },
    alerts: { id: newResourceId(), project_id: projectId, type: 'health-failing', key: 'health-failing:prod', state: 'firing', detail: 'private-detail:' + projectId, fired_at: new Date().toISOString(), resolved_at: null },
    cost_visibility: { project_id: projectId, revision: 1, document: { projectId, private: 'cost-private' } },
    cost_visibility_receipts: { project_id: projectId, request_key: newResourceId(), fingerprint: 'receipt', document: { projectId } },
    usage_sources: { task_key: taskKey, source_id: 'shared-source-name', cursor: '1' },
    usage_pages: { task_key: taskKey, source_id: 'shared-source-name', cursor: '1', fingerprint: 'page' },
    usage_events: { task_key: taskKey, source_id: 'shared-source-name', event_id: 'shared-event-name', fingerprint: 'event' },
    usage_evidence: { meter_key: meterKey, revision: 1, fingerprint: 'evidence', document },
    usage_projections: { meter_key: meterKey, task_key: taskKey, document },
    usage_changes: { meter_key: meterKey, task_key: taskKey, sequence: 1, document },
    usage_snapshots: { id: newResourceId(), task_key: taskKey, through: 3, visibility_revision: 1, created_at: 0, expires_at: 1 },
    execution_valuations: { meter_key: jsonHash('valuation:' + meterKey), task_key: taskKey, basis_fingerprint: 'basis', document },
    execution_valuation_receipts: { task_key: taskKey, request_key: newResourceId(), fingerprint: 'value', document },
    development_model_evidence: { meter_key: meterKey, revision: 1, fingerprint: 'model', document: { meter: { identity }, private: 'model-private' } },
    native_captures: { id: captureId, task_key: taskKey, source_id: 'shared-source-name', turn: '1', lineage_key: 'shared-lineage', root: 'shared-root', finalized: false, document, summary: document },
    native_capture_history: { capture_id: captureId, task_key: taskKey, sequence: 2, document },
    native_steps: { capture_id: captureId, task_key: taskKey, record_id: 'shared-record', native_key: 'shared-native', revision: 1, fingerprint: 'step', root: 'shared-root', model_evidence: null },
    native_baselines: { capture_id: captureId, task_key: taskKey, ordinal: 0, native_key: 'shared-native', document, status: 'baseline', owner_id: null },
    native_repairs: { meter_key: meterKey, task_key: taskKey, valuation_key: jsonHash('valuation:' + meterKey), native_key: 'shared-native', active: true, document },
  };
  for (const [name, value] of Object.entries(rows)) await insertRow(database, name, value);
  return { rows, taskId, executionId, taskKey, meterKey, captureId };
}
