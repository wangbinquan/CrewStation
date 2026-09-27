import type { Actor, ProjectId, RuntimeImageExecutionSnapshot, RuntimeImageSelection, RuntimeImageValidationTarget, TaskId } from '@crewstation/contracts';

export interface BusinessImageBindings {
  inspectReference?(projectId: string, owner: { type: 'task' | 'agent'; id: string }, snapshot: RuntimeImageExecutionSnapshot): Promise<boolean>;
  reserveImage(actor: Actor, projectId: string, input: { owner: { type: 'task' | 'agent'; id: string }; selection: RuntimeImageSelection; target: RuntimeImageValidationTarget; requestedVersionId?: string }): Promise<RuntimeImageExecutionSnapshot | undefined>;
  confirmReference(versionId: string, owner: { type: 'task' | 'agent'; id: string }): Promise<void>;
  releaseReference(versionId: string, owner: { type: 'task' | 'agent'; id: string }): Promise<void>;
  copyReference(projectId: string, versionId: string, from: { type: 'agent' | 'task'; id: string }, to: { type: 'agent' | 'task'; id: string }): Promise<void>;
}
/** 只接给通过来源 Pod 验证的业务执行入口，项目边界与 release 允许集合仍由镜像能力复核。 */
export function businessImagePorts(images: BusinessImageBindings, actor: Actor) {
  return {
    inspectReference: (projectId: ProjectId, owner: { type: 'task' | 'agent'; id: TaskId }, snapshot: RuntimeImageExecutionSnapshot) => images.inspectReference?.(projectId, owner, snapshot) ?? Promise.resolve(false),
    release: (snapshot: RuntimeImageExecutionSnapshot, owner: { type: 'task' | 'agent'; id: TaskId }) => images.releaseReference(snapshot.versionId, owner),
    reserveAgent: (projectId: ProjectId, taskId: TaskId, selection: RuntimeImageSelection, profile: { profileId: string; revision: number }, requestedVersionId?: string) => images.reserveImage(actor, projectId, { owner: { type: 'agent', id: taskId }, selection, target: { usage: 'agent', profile }, ...(requestedVersionId ? { requestedVersionId } : {}) }),
    confirmAgent: (snapshot: RuntimeImageExecutionSnapshot, id: TaskId) => images.confirmReference(snapshot.versionId, { type: 'agent', id }),
    restoreAgent: (projectId: ProjectId, snapshot: RuntimeImageExecutionSnapshot, from: TaskId, to: TaskId) => images.copyReference(projectId, snapshot.versionId, { type: 'agent', id: from }, { type: 'agent', id: to }),
    restoreTask: (projectId: ProjectId, snapshot: RuntimeImageExecutionSnapshot, from: TaskId, to: TaskId) => images.copyReference(projectId, snapshot.versionId, { type: 'task', id: from }, { type: 'task', id: to }),
    reserveTask: (projectId: ProjectId, taskId: TaskId, selection: RuntimeImageSelection, requestedVersionId?: string) => images.reserveImage(actor, projectId, { owner: { type: 'task', id: taskId }, selection, target: { usage: 'task' }, ...(requestedVersionId ? { requestedVersionId } : {}) }),
    confirmTask: (snapshot: RuntimeImageExecutionSnapshot, id: TaskId) => images.confirmReference(snapshot.versionId, { type: 'task', id }),
  };
}
