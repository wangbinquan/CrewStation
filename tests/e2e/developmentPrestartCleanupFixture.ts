// Actual Dev, Session, Resources and Task PostgreSQL owners plus original Controller; only Kubernetes/Runner transport is controlled.
import { runMigrations } from '../../packages/persistence';
import { createSessionModule, sessionMigrations } from '../../modules/session/wiring';
import { createDevSessionModule, devSessionMigrations } from '../../modules/dev-session/wiring';
import { workspaceFixture } from '../../modules/dev-session/tests/workspaceFixture';
import { developmentEndingStore } from '../../modules/dev-session/adapters/persistence/ending/store';
import { developmentCleanupPort } from '../../modules/platform/application/developmentCleanupPorts';
import { developmentPrestartCleanupFixture } from '../../modules/task-runtime/tests/developmentPrestartCleanupFixture';
import type { DevelopmentCleanupSession } from '../../modules/dev-session/ports/developmentCleanup';
import { originalOwner } from './developmentCleanupFixture';

export async function developmentPrestartCleanupChain() {
  const f = await developmentPrestartCleanupFixture();
  await runMigrations(f.tdb.db, [devSessionMigrations, sessionMigrations]);
  const original = await originalOwner(f), calls: string[] = [], control = { lookupFailure: false };
  const session = createSessionModule({ db: f.tdb.db, runnerAuth: f.runtime.api, taskAccess: f.runtime.api, isAdmin: async () => false,
    settings: { selfAddress: 'http://prestart.test', commandTimeoutMs: 1000, runnerStaleMs: 30000, replayLimit: 100 } });
  const port: DevelopmentCleanupSession = {
    lookupDevelopmentUsage: async (id) => { calls.push('lookup'); if (control.lookupFailure) throw new Error('actual lookup transport unavailable'); return session.api.lookupDevelopmentUsage(id); },
    registerDevelopmentUsage: async (input) => { calls.push('register'); return session.api.registerDevelopmentUsage(input); },
    getDevelopmentUsage: (id, key) => session.api.getDevelopmentUsage(id, key),
    requestDevelopmentUsageDrain: (id, key, reason) => session.api.requestDevelopmentUsageDrain(id, key, reason),
    sendCommand: async () => { calls.push('command'); throw new Error('an unstarted original execution must not receive a fabricated numeric command'); },
  };
  const base = workspaceFixture().deps;
  const dev = createDevSessionModule({ ...base, db: f.tdb.db, isAdmin: async () => true, clock: original.clock,
    environments: original.environments, developmentCleanupSession: port, developmentCleanupWorkloadSafety: f.safety });
  const participant = developmentCleanupPort(f.runtime.api, dev.api.developmentCleanup!);
  f.replace({ developmentCleanup: participant });
  const finalize = async () => {
    try { await f.finalize(); }
    catch (error) {
      const task = await f.load(f.env.id), resource = await f.resources.api.get(f.env.id), job = await developmentEndingStore(f.tdb.db, original.clock).get(f.env.id);
      console.error('original prestart failure evidence', JSON.stringify({ state: task.state, nativeState: task.native?.state,
        cleanup: task.native?.developmentCleanup, resource: { phase: resource?.phase, desired: resource?.desired, conditions: resource?.conditions },
        ending: job, controllerMessages: f.calls.filter((v) => v.startsWith('warn:') || v.startsWith('error:')).slice(-5) }));
      throw error;
    }
  };
  return { ...f, finalize, get runtime() { return f.runtime; }, ...original, session, port, calls, control, participant,
    store: developmentEndingStore(f.tdb.db, original.clock) };
}
export type DevelopmentPrestartCleanupChain = Awaited<ReturnType<typeof developmentPrestartCleanupChain>>;
