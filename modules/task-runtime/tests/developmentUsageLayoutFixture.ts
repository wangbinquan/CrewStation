import type { TaskId } from '@crewstation/contracts';
import { UserIdSchema } from '@crewstation/contracts';
import { newId } from '@crewstation/kernel';
import { createTaskRuntimeModule } from '../wiring';
import type { CreateNativeExecutionInput } from '../api/moduleApi';
import type { rebuildFixture } from './rebuildFixture';
export type LayoutFixture = Awaited<ReturnType<typeof rebuildFixture>>;
const unexpected = async (): Promise<never> => { throw new Error('Read-only layout lookup called another subsystem'); };
export function layoutExecution(f: LayoutFixture): CreateNativeExecutionInput {
  return { id: newId('tsk') as TaskId, parentTaskId: f.env.id, purpose: 'agent', createdBy: UserIdSchema.parse('01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb'), agentId: newId('agt'),
    runnerId: crypto.randomUUID(), fingerprint: 'original-start', computeProfile: { profileId: f.state.profiles[0]!.id, revision: 3 }, developmentUsageStorage: { version: 1 } };
}
/** Rebuild the actual module on the same DB; all unrelated provider calls fail. */
export function restoreLayoutModule(f: LayoutFixture) {
  return createTaskRuntimeModule({ db: f.tdb.db, k8s: f.k8s, authorizer: { authorize: unexpected }, isAdmin: unexpected, quotas: { quotaLimit: unexpected },
    profiles: { devSessionProfile: unexpected, listTaskProfiles: unexpected, getTaskProfile: unexpected }, services: { resolveServiceById: unexpected },
    sources: { configEnv: unexpected, dataEnv: unexpected, taskDataEnv: unexpected },
    settings: { taskImage: 'current-image-not-used', sessionUrl: 'ws://offline', systemNamespace: 'cs-system', userDomain: 'localhost', serviceDomain: 'svc.localhost', workerUid: 10001, defaultProfile: f.state.profiles[1]!.id, userAuthMiddleware: 'auth', dropIdentityHeadersMiddleware: 'drop' },
    clock: { now: () => { throw new Error('Lookup must not invent observed/model time'); } } });
}
