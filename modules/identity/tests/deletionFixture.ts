import { PROJECT_DELETION_PHASES, ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionPhase, ProjectId, ReleaseId, TaskId, UserId, WorkloadIdentity } from '@crewstation/contracts';
import { jsonHash, newId, precondition } from '@crewstation/kernel';
import type { Database } from '@crewstation/persistence';
import { createIdentityModule } from '../wiring';
import { BASE_SETTINGS } from './identityFixture';

export function identityDeletionFixture(db: Database) {
  const closed = new Set<ProjectId>(), ids = new Map<string, ProjectId>(), workloads = new Map<string, WorkloadIdentity>();
  const identity = createIdentityModule({ db, settings: BASE_SETTINGS, projectLifecycle: { available: async (id) => !closed.has(id) },
    projectDirectory: { idBySlug: async (slug) => ids.get(slug) }, workloadLookup: { byIp: async (ip) => workloads.get(ip) },
    devSessionState: { activeSession: async () => ({ projectId: ids.get('identity-delete')! }) },
    allowlistEvaluator: { evaluate: async () => ({ allowed: true, targetIdentity: 'platform-api' }) } });
  const make = async (id = newId('project') as ProjectId, slug = 'identity-delete') => {
    const target = ProjectDeletionTargetSchema.parse({ id, slug, name: '身份清理', namespace: `cs-${slug}`, serviceId: newId('service'), kind: 'DigitalWorker', state: 'active', revision: '0',
      prodHost: `${slug}.cs.localhost`, previewHost: `preview.${slug}.cs.localhost`, serviceHost: `${slug}.svc.cs.internal` });
    ids.set(slug, id);
    const owner = identity.api.projectDeletionOwner(async (context) => {
      // 此 owner 用例注入原许可端口。project 的实际租约／全参与者阶段屏障由独立真实 PG 用例验证。
      if (context.generation !== grant.generation || !grant.valid || context.operationId !== grant.operationId || context.phase !== grant.phase ||
        jsonHash(context.target) !== jsonHash(target) || jsonHash(context.confirmed) !== jsonHash(grant.confirmed)) throw precondition('grant invalid');
    });
    const confirmed = await owner.inspect(target);
    const grant = { generation: 1, valid: true, operationId: newId('deletion'), phase: 'seal' as ProjectDeletionPhase, confirmed };
    const context = (): ProjectDeletionContext => ({ operationId: grant.operationId, generation: grant.generation, phase: grant.phase, target, confirmed });
    const run = (phase: ProjectDeletionPhase) => { grant.phase = phase; return owner.run(context()); };
    return { target, owner, grant, context, run };
  };
  const sources = (slug: string) => {
    const taskId = newId('task') as TaskId;
    const service: WorkloadIdentity & { source: NonNullable<WorkloadIdentity['source']> } = { identity: `${slug}/${slug}`, project: slug, service: slug, kind: 'service', slot: 'prod',
      source: { ip: '10.0.0.1', podUid: 'original-service-pod', releaseId: newId('release') as ReleaseId, physicalSlot: 'blue', ready: true } };
    const dev: WorkloadIdentity & { developmentSource: NonNullable<WorkloadIdentity['developmentSource']> } = { identity: `${slug}/${slug}`, project: slug, service: slug, kind: 'dev-session', taskId,
      developmentSource: { ip: '10.0.0.2', podName: 'original-dev-pod', podUid: 'original-dev-pod-uid', taskId, ready: true } };
    workloads.set('10.0.0.1', service); workloads.set('10.0.0.2', dev);
    return { taskId, service, dev };
  };
  const credential = (setup: Awaited<ReturnType<typeof make>>, userId: UserId, taskId: TaskId) => identity.api.issueDevSessionToken({ projectId: setup.target.id, serviceId: setup.target.serviceId!, taskId, userId });
  const allPhases = async (setup: Awaited<ReturnType<typeof make>>) => { for (const phase of PROJECT_DELETION_PHASES) await setup.run(phase); };
  return { identity, make, closed, ids, sources, credential, allPhases };
}
