import type { ProjectDeletionContext, ProjectDeletionInventory } from '@crewstation/contracts';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { resourceIdentityDirectory } from '@crewstation/persistence';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { TestDatabase } from '@crewstation/testkit';
import { observabilityMigrations } from '../wiring';
import { observabilityDeletionRepository } from '../adapters/persistence/projectDeletion';
import { observabilityDeletionOwner } from '../application/projectDeletion';

export const target = ProjectDeletionTargetSchema.parse({ id: '01a0bf5d-8f4b-7178-82e1-9a99060b1192', slug: 'demo', name: 'Demo', namespace: 'cs-demo',
  kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'demo.cs.localhost', previewHost: 'preview.demo.cs.localhost', serviceHost: 'demo' });
export const otherId = '01a0bf5d-8f4b-7178-82e1-9a99060b1193';
export async function fixture() {
  const database = await createTestDatabase([observabilityMigrations]);
  const operationId = newResourceId(), identities = resourceIdentityDirectory(database.db, () => [observabilityMigrations]);
  const input = { db: database.db, identities, assertGrant: async (context: ProjectDeletionContext) => {
    if (context.operationId !== operationId) throw new Error('wrong operation');
  } };
  const repository = observabilityDeletionRepository(input), owner = observabilityDeletionOwner(repository);
  const context = (confirmed: ProjectDeletionInventory, phase: ProjectDeletionContext['phase'], generation = 1): ProjectDeletionContext => ({ operationId, target, confirmed, phase, generation });
  return { database, operationId, input, repository, owner, context };
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
export function agentCallRow(projectId: string | null, patch: Record<string, unknown> = {}) {
  const at = new Date().toISOString();
  return { id: crypto.randomUUID(), project_id: projectId, source: projectId === null ? 'platform' : 'business', kind: projectId === null ? 'profile-test' : 'subtask',
    task_id: newResourceId(), task_label: 'private-task-label:' + projectId, subtask_id: null, attempt: null, runtime_task_id: newResourceId(), agent_id: newResourceId(),
    agent_key: 'agent', agent_label: 'Agent', profile_id: 'builtin:opencode', profile_revision: null, profile_name: null, protocol: 'opencode',
    status: 'done', started_at: at, ended_at: at, updated_at: at, usage_state: 'complete', input_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0,
    output_tokens: 5, reasoning_tokens: 0, cost_nano: 0, cost_state: 'unpriced', ...patch };
}
/** Every project content family: alerts, an Agent call with its model row, and cost visibility. */
export async function seed(database: TestDatabase, projectId: string) {
  const call = agentCallRow(projectId);
  const rows: Record<string, Record<string, unknown>> = {
    alerts: { id: newResourceId(), project_id: projectId, type: 'health-failing', key: 'health-failing:prod', state: 'firing', detail: 'private-detail:' + projectId, fired_at: new Date().toISOString(), resolved_at: null },
    agent_calls: call,
    agent_call_models: { call_id: call.id, model: 'provider/model', input_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 5, reasoning_tokens: 0, price_id: null, cost_nano: null, cost_state: 'unpriced' },
    project_cost_visibility: { project_id: projectId, visible: true, updated_at: new Date().toISOString(), updated_by: newResourceId() },
  };
  for (const [name, value] of Object.entries(rows)) await insertRow(database, name, value);
  return { rows, call };
}
