import { PROJECT_DELETION_PARTICIPANTS } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionOwner, ProjectDeletionParticipant, ProjectDeletionStepResult, ProjectId } from '@crewstation/contracts';
import type { ProjectDeletionApi } from '@crewstation/module-project';
import { jsonHash } from '@crewstation/kernel';

interface ExternalObject { projectId: ProjectId; uid: string; exists: boolean; running: boolean; storage: boolean; metadata: boolean; sealed: boolean }
/** 有状态替身只证明编排与屏障；实机 owner 验收独立进行，不能把此替身当物理资源证据。 */
export function statefulDeletionOwners(project: ProjectDeletionApi) {
  const objects = new Map<string, ExternalObject>(), calls: { participant: ProjectDeletionParticipant; phase: string; projectId: ProjectId }[] = [];
  const unavailable = new Set<ProjectDeletionParticipant>(), waitStop = new Set<ProjectDeletionParticipant>(), retainStorage = new Set<ProjectDeletionParticipant>(), loseReceipt = new Set<ProjectDeletionParticipant>();
  const key = (participant: ProjectDeletionParticipant, id: ProjectId) => `${participant}/${id}`;
  const inspect = (participant: ProjectDeletionParticipant, id: ProjectId): ProjectDeletionInventory => {
    if (unavailable.has(participant)) throw new Error('source unavailable');
    const object = objects.get(key(participant, id));
    const resources = object ? [{ kind: 'test-owned-object', id: key(participant, id), identity: object.uid, count: 1,
      scope: participant === 'api-catalog' ? 'metadata' as const : 'physical' as const, ...(participant === 'api-catalog' ? {} : { sourceIdentity: object.uid }) }] : [];
    return { participant, revision: jsonHash(resources), complete: true, resources, references: [], blockers: [] };
  };
  const run = async (participant: ProjectDeletionParticipant, context: ProjectDeletionContext): Promise<ProjectDeletionStepResult> => {
    await project.assertProjectDeletionGrant(context);
    const id = context.target.id, object = objects.get(key(participant, id)), original = context.confirmed.resources[0];
    calls.push({ participant, phase: context.phase, projectId: id });
    const blocked = (code: string, message: string): ProjectDeletionStepResult => ({ kind: 'blocked', blockers: [{ participant, code, message }] });
    if (object && original?.identity !== object.uid) return blocked('identity-changed', '同名资源身份已经替换，保留新资源');
    if (context.phase === 'seal' && object) object.sealed = true;
    if (context.phase === 'stop' && object) {
      if (waitStop.has(participant)) return { kind: 'waiting', reason: '等待实际消费者停止证明' };
      object.running = false;
    }
    if (context.phase === 'purge' && object) {
      if (!object.sealed || object.running) return blocked('consumer-live', '实际消费者尚未排空');
      object.exists = false; object.storage = retainStorage.has(participant);
      if (loseReceipt.delete(participant)) throw new Error('side effect committed; response lost');
    }
    if (context.phase === 'prove' && object && (object.exists || object.storage)) return { kind: 'waiting', reason: '等待原存储实际回收证明' };
    if (context.phase === 'metadata' && object) object.metadata = false;
    if (context.phase === 'verify' && object && (object.exists || object.storage || object.metadata || object.running)) return blocked('residual', '完整复盘仍有项目内容');
    return { kind: 'done', evidence: { kind: ['purge', 'prove', 'namespace'].includes(context.phase) ? 'physical' : 'metadata',
      digest: jsonHash({ participant, operationId: context.operationId, phase: context.phase, identity: original?.identity, remaining: 0 }), description: `有状态测试对象的 ${context.phase} 证明`, count: original ? 1 : 0 } };
  };
  const owners: ProjectDeletionOwner[] = PROJECT_DELETION_PARTICIPANTS.map((participant) => participant === 'project' ? project.deletionOwner : {
    participant, inspect: async (target) => inspect(participant, target.id), run: (context) => run(participant, context),
  });
  const add = (id: ProjectId) => { for (const participant of PROJECT_DELETION_PARTICIPANTS) if (participant !== 'project') objects.set(key(participant, id), {
    projectId: id, uid: `${participant}-${id}`, exists: true, running: true, storage: true, metadata: true, sealed: false,
  }); };
  const state = (participant: ProjectDeletionParticipant, id: ProjectId) => objects.get(key(participant, id))!;
  return { owners, objects, calls, unavailable, waitStop, retainStorage, loseReceipt, add, state };
}
