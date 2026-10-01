import postgres from 'postgres';
import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectId } from '@crewstation/contracts';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { generateSecretKey } from '@crewstation/secretbox';
import { DEFAULT_TEST_DATABASE_URL, createTestDatabase } from '@crewstation/testkit';
import { createDataControlModule, dataControlMigrations } from '../wiring';
import type { NativeDeletionHistory } from '../ports/dataPlane';
import type { NativePostgresSource, NativePostgresStorageSource } from '../api/storageSource';
import type { NativeDdlConnection } from '../api/databaseRemoval';

export const nativeOwnerUrl = process.env.CS_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
type HistoryRead = Awaited<ReturnType<NativeDeletionHistory['read']>>;
type FixtureHistory = { -readonly [K in keyof HistoryRead]: HistoryRead[K] };
export const fixtureError = <T>(promise: PromiseLike<T>): Promise<T> => Promise.resolve(promise).catch((error: unknown) => { throw error instanceof Error ? error.cause ?? error : error; });
export async function nativeOwnerFixture(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>, create = true) {
  const fixture = await setup(create);
  try { await run(fixture); }
  finally {
    for (const finish of fixture.finalizers.reverse()) await finish();
    for (const row of await fixture.admin.unsafe<{ name: string }[]>('SELECT datname AS name FROM pg_database WHERE datname=$1 OR oid IN (SELECT value::oid FROM jsonb_array_elements_text($2::text::jsonb))', [fixture.name, JSON.stringify(fixture.databaseOids)])) await fixture.admin.unsafe('DROP DATABASE "' + row.name + '"');
    for (const role of fixture.roleNames.reverse()) await fixture.admin.unsafe('DROP ROLE IF EXISTS "' + role + '"');
    await fixture.module.observer.stop(); await fixture.admin.end(); await fixture.database.drop();
  }
}
async function setup(create: boolean) {
  const database = await createTestDatabase([dataControlMigrations]), admin = postgres(nativeOwnerUrl, { max: 1, onnotice: () => undefined });
  const origin = { projectId: Bun.randomUUIDv7() as ProjectId, resourceId: Bun.randomUUIDv7() }, name = 'cs_owner_' + Bun.randomUUIDv7().replaceAll('-', '').slice(-16), role = name + '_r';
  const roleNames = [role], databaseOids: string[] = [], finalizers: Array<() => Promise<unknown>> = [];
  let epoch = 1, rejectGrant = false, grantGeneration = 1, verificationHook: ((connection: NativeDdlConnection) => Promise<void>) | undefined; const nativeGuards: number[] = [];
  // Real PostgreSQL catalog/filesystem operations, with a controlled independent-source port.
  // These tests do not claim real Kubernetes/PVC epoch proof; the installed source has separate acceptance.
  const source: NativePostgresSource = {
    capture: async (connection) => {
      await connection.assertHeld();
      const [row] = await connection.query<{ pid: number; directory: string; identifier: string; exists: boolean }[]>("SELECT pg_backend_pid() AS pid,current_setting('data_directory') AS directory,(SELECT system_identifier::text FROM pg_control_system()) AS identifier,(pg_stat_file('base')).isdir AS exists");
      if (!row?.exists) throw precondition('fixture PostgreSQL directory missing'); nativeGuards.push(row.pid);
      const storage: NativePostgresStorageSource = { identity: jsonHash([row.identifier, 'controlled-source', epoch]), serviceUid: 'fixture-service', server: { podUid: 'fixture-postgres', containerId: 'fixture-container', nodeUid: 'fixture-node', address: '127.0.0.1' }, volumes: [{ pvcUid: 'fixture-pvc', pvUid: 'fixture-pv', nodeUid: 'fixture-node', mountPath: row.directory, providerPath: row.directory, rootEpoch: jsonHash(['root', epoch]), volumeEpoch: jsonHash(['volume', epoch]), entries: [{ key: 'pgdata', relativePath: 'pgdata', kind: 'directory', identity: jsonHash(['pgdata', epoch]) }, { key: 'control', relativePath: 'pgdata/global/pg_control', kind: 'file', identity: jsonHash(['control', epoch]) }] }], observedAt: new Date().toISOString() };
      return storage;
    },
    verify: async (connection, original) => { if ((await source.capture(connection)).identity !== original.identity) throw precondition('fixture original volume replaced'); await verificationHook?.(connection); },
  };
  const module = createDataControlModule({ db: database.db, secretKeyBase64: generateSecretKey(), adminUrl: nativeOwnerUrl, nativePostgresSource: source, ledger: { get: async () => undefined, listLive: async () => [], changesSince: async () => [], latestChange: async () => 0, observe: async () => ({ status: 'unchanged' }) } });
  const historyValue: FixtureHistory = { complete: true, revision: jsonHash('history'), records: [{ resourceId: origin.resourceId, aliases: [], names: [{ kind: 'database', name }, { kind: 'role', name: role }] }], blockers: [], references: [] };
  const history: NativeDeletionHistory = { read: async () => historyValue };
  const assertGrant = async (context: ProjectDeletionContext) => { if (rejectGrant || context.target.id !== origin.projectId || context.operationId !== operationId || context.generation !== grantGeneration) throw precondition('fixture deletion grant expired'); };
  const owner = () => module.api.projectDeletion!.owner({ history, assertGrant });
  const target = { id: origin.projectId, slug: 'native-owner', name: '原生永久清理夹具', namespace: 'cs-native-owner', state: 'active', kind: 'DigitalWorker', revision: '1', prodHost: 'native.apps.test', previewHost: 'preview.native.apps.test', serviceHost: 'native.services.test' } as const;
  const operationId = Bun.randomUUIDv7();
  const context = (confirmed: ProjectDeletionInventory, phase: ProjectDeletionContext['phase']): ProjectDeletionContext => ProjectDeletionContextSchema.parse({ operationId, generation: 1, target, phase, confirmed });
  if (create) {
    await module.api.nativePostgres!.credential!(origin, role);
    await module.api.nativePostgres!.run(origin, [name, role], async (connection) => { await connection.query('CREATE ROLE "' + role + '" NOLOGIN'); await connection.query('CREATE DATABASE "' + name + '" OWNER "' + role + '"'); });
    const [created] = await admin.unsafe<{ oid: string }[]>('SELECT oid::text FROM pg_database WHERE datname=$1', [name]); databaseOids.push(created!.oid);
  }
  const catalog = () => admin.unsafe<{ kind: string; name: string; oid: string }[]>("SELECT 'database' AS kind,datname AS name,oid::text FROM pg_database WHERE datname=$1 UNION ALL SELECT 'role' AS kind,rolname AS name,oid::text FROM pg_roles WHERE rolname=$2 ORDER BY kind", [name, role]);
  return { database, admin, origin, name, role, module, owner, target, context, historyValue, source, nativeGuards, databaseOids, roleNames, finalizers, catalog, replaceSource: () => { epoch += 1; }, expireGrant: () => { rejectGrant = true; }, restoreGrant: () => { rejectGrant = false; }, takeover: () => ++grantGeneration, verificationHook: (hook?: (connection: NativeDdlConnection) => Promise<void>) => { verificationHook = hook; } };
}
