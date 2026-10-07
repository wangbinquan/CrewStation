// Controlled owner/rates; actual WAL, runner journal, Session API/PG, platform source and Observability factory.
import type { TestDatabase } from '../../../packages/testkit';
import type { DevelopmentUsageResolved, DevelopmentUsageSource } from '../../../modules/observability/ports/developmentUsage';
import { createSessionModule } from '../../../modules/session/wiring';
import { createObservabilityModule } from '../../../modules/observability/wiring';
import { developmentObservationSource } from '../../../modules/platform/application/developmentObservationPorts';
import { createFakeK8sClient } from '../../../packages/k8s';
import { jsonHash } from '../../../packages/kernel';
import { drizzleExecutionPricing } from '../../../modules/observability/adapters/persistence/drizzleTokenPricing';
import { nativeNumericFixture } from './nativeNumericFixture';
import { nativeNumericPrice } from './nativeNumericPrice';

export async function nativeLiveFixture(database: TestDatabase, options: { failAfterAck?: boolean; missingOriginalPort?: boolean } = {}) {
  const native = await nativeNumericFixture(database), execution = await native.execution(false);
  const price = await nativeNumericPrice(database, execution.registration);
  const session = createSessionModule({ db: database.db, runnerAuth: { verifyRunnerToken: async () => ({ ok: false, reason: 'unused' }) },
    taskAccess: { canOpenStream: async () => false, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} }, isAdmin: async () => false,
    settings: { selfAddress: 'http://127.0.0.1', commandTimeoutMs: 10000, runnerStaleMs: 30000, replayLimit: 100 } });
  const accepted = await drizzleExecutionPricing(database.db).get(execution.registration.identity);
  if (!accepted) throw new Error('Actual accepted fixture CNY price missing');
  let owner: DevelopmentUsageResolved = { registration: structuredClone(execution.registration), price: accepted,
    nativeSelection: { version: 2, expectedNamespace: 'acceptance-native-lineage' } };
  const base = developmentObservationSource({ resolve: async key => jsonHash(key) === jsonHash(execution.registration.key) ? owner : undefined }, session.api);
  let acked = false, fail = options.failAfterAck ?? false;
  const reads: Array<{ passId: string; ordinal: string; afterAck: boolean }> = [];
  const original: DevelopmentUsageSource = { ...base, acknowledge: async (key, through) => { await base.acknowledge(key, through); acked = true; },
    nativePage: async (key, passId, ordinal) => {
      reads.push({ passId, ordinal, afterAck: acked });
      if (acked && fail) throw new Error('controlled failure after durable original ACK');
      return base.nativePage(key, passId, ordinal);
    } };
  const { nativePage: _read, ...withoutPage } = original;
  const source: DevelopmentUsageSource = options.missingOriginalPort ? withoutPage : original;
  const empty = async () => [];
  const reopen = () => createObservabilityModule({ db: database.db, k8s: createFakeK8sClient(), isAdmin: async () => false,
    developmentUsageSource: source, authorizer: { authorize: async () => undefined },
    services: { resolveServiceOfProject: async () => { throw new Error('unused'); } }, slots: { slotRoles: async () => ({ prod: 'blue', preview: 'green' }) },
    traces: { environments: { traceKeys: empty, activeTraceIds: empty, list: empty }, deliveries: { traceKeys: empty, activeTraceIds: empty, list: empty },
      businessTasks: { list: empty }, sessions: { summarize: empty, events: empty } } });
  return { ...native, execution, session, price, reads, module: reopen(), reopen,
    allowRecoveredWork: () => { fail = false; }, replaceOwner: (next: DevelopmentUsageResolved) => { owner = next; }, owner: () => structuredClone(owner) };
}
