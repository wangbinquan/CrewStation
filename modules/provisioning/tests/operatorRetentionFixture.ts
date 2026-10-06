import type { Actor, ProjectDeletionTarget } from '@crewstation/contracts';
import { ManifestSchema, ProjectIdSchema } from '@crewstation/contracts';
import { eventbusMigrations, readEventContents } from '@crewstation/eventbus';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { readMigrationDir } from '@crewstation/persistence';
import { queueMigrations, readQueueContents } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { provisioningOperatorRepairs } from '../adapters/persistence/operatorRepairs';
import type { InfrastructureOriginSources } from '../ports/infrastructureOrigins';

async function allRows<T extends { id: string }>(read: (after: string | null) => Promise<readonly T[]>) {
  const result: T[] = []; let after: string | null = null;
  for (;;) { const rows = await read(after); if (!rows.length) return result; result.push(...rows); after = rows.at(-1)!.id; }
}

export async function operatorRetentionFixture() {
  const database = await createTestDatabase([queueMigrations, eventbusMigrations, { module: 'provisioning', layer: 6, files: readMigrationDir(new URL('../adapters/persistence/migrations', import.meta.url).pathname) }]);
  const target = { id: newResourceId(), serviceId: newResourceId(), slug: 'retention-target', name: 'Target', namespace: 'cs-retention-target', kind: 'DigitalWorker', state: 'active', revision: '1',
    prodHost: 'retention-target.example.test', previewHost: 'preview.retention-target.example.test', serviceHost: 'retention-target.svc.internal' } as ProjectDeletionTarget;
  const foreign = ProjectIdSchema.parse(newResourceId()), actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
  const state = { known: false, active: false, profileActive: false, retired: false, complete: true, shared: false, failure: false, profileComplete: true, aliases: [] as string[], revision: 1 };
  const calls: string[] = [];
  const origins: InfrastructureOriginSources = { resolve: async (_document, ref, representation) => {
    calls.push(representation + ':' + ref.kind + ':' + ref.key); if (state.failure) throw new Error('Source unavailable');
    const own = ref.key === target.id || ref.key === target.serviceId;
    return own || state.known ? { complete: true, id: ref.key, scope: 'project', projectIds: [own ? target.id : foreign], revision: jsonHash(state.revision) } : undefined;
  }, currentProfileTestEvidence: async id => ({ complete: state.profileComplete, id, retired: state.retired, active: state.profileActive, aliases: state.aliases, digest: jsonHash(state) }) as never,
  currentAssets: { inspect: async () => ({ complete: state.complete, digest: jsonHash(state), activeConsumers: state.active ? ['foreign/current@uid'] : [], targetReferences: state.shared ? ['shared-target'] : [] }) as never } };
  const queue = async (kind: string, payload: unknown, status = 'done') => {
    const [row] = await database.db.execute<{ id: string }>(sql`INSERT INTO platform_infra.jobs(kind,payload,state,last_error)
      VALUES(${kind},${JSON.stringify(payload)}::jsonb,${status},'original private error') RETURNING id::text AS id`); return row!.id;
  };
  const event = async (topic: string, payload: unknown) => {
    const [row] = await database.db.execute<{ id: string }>(sql`INSERT INTO platform_infra.domain_events(topic,payload,occurred_at)
      VALUES(${topic},${JSON.stringify(payload)}::jsonb,'2026-10-06'::timestamptz) RETURNING id::text AS id`); return row!.id;
  };
  const snapshot = async () => ({ queue: await allRows(after => readQueueContents(database.db, after)), event: await allRows(after => readEventContents(database.db, after)),
    errors: await database.db.execute(sql`SELECT to_jsonb(d) AS body FROM platform_infra.event_dead_letters d ORDER BY event_id,consumer`) });
  const manifest = ManifestSchema.parse({ apiVersion: 'crewstation/v2', kind: 'DigitalWorker', spec: { service: { servicePlanId: newResourceId(), command: ['bun', 'app.ts'], port: 3000 } } });
  const payloads = { created: { projectId: foreign, slug: 'removed-project', namespace: 'cs-removed-project', kind: 'DigitalWorker', occurredAt: '2026-10-06T00:00:00Z' },
    archived: { projectId: foreign, occurredAt: '2026-10-06T00:00:00Z' },
    status: { serviceId: newResourceId(), releaseId: newResourceId(), status: 'ready', occurredAt: '2026-10-06T00:00:00Z' },
    registered: { projectId: foreign, serviceId: newResourceId(), releaseId: newResourceId(), tag: 'v1', commitSha: 'a'.repeat(40), manifest, occurredAt: '2026-10-06T00:00:00Z' } };
  return { database, target, foreign, actor, state, calls, origins, queue, event, snapshot, payloads, owner: () => provisioningOperatorRepairs(database.db, origins) };
}
