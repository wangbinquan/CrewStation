import type { BusinessStorageFinalization } from '@crewstation/contracts';
import { conflict, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { ArchiveExecution } from '../../domain/archiveExecution';
import type { ArchiveCredentials, ArchiveExecutionStore } from '../../ports/archiveExecution';
import type { ArchiveExecutionApi } from '../../api/archiveExecution';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { runtimeBackground } from '../deletion/background';

export interface ArchiveExecutionDeps { runtime: TaskRuntimeUseCaseDeps; store: ArchiveExecutionStore; credentials: ArchiveCredentials; apiUrl: string }
function match(e: ArchiveExecution, input: BusinessStorageFinalization): void {
  if (e.taskId !== input.taskId || e.projectId !== input.projectId || e.serviceId !== input.serviceId || e.operationId !== input.operationId || e.revision !== input.revision || e.volumeUid !== input.volumeUid) throw conflict('归档执行不属于当前终结修订');
}
export function archiveExecution(deps: ArchiveExecutionDeps): ArchiveExecutionApi {
  const { store, runtime, credentials } = deps;
  const requireExecution = async (id: string) => { const e = await store.get(id); if (!e) throw notFound('归档执行'); return e; };
  const stop = async (e: ArchiveExecution) => {
    if (!runtime.workloadSafety) throw precondition('工作卷消费者保护不可用');
    await runtime.workloadSafety.closeAdmission({ resourceId: e.id, namespace: e.namespace, podName: e.podName,
      consumer: { id: e.consumerId, taskId: e.taskId, revision: e.revision, purpose: 'archive', finalization: { operationId: e.operationId, revision: e.revision } } });
    await store.stopping(e.id);
    const record = await store.record(e.id);
    if (record && record.phase !== 'stopped') return false;
    // Closing the data grant is a durable tombstone even if Secret creation never happened.
    if (e.purpose !== 'binding') await credentials.close(e.id); await store.stopped(e.id); return true;
  };
  let after: string | undefined;
  return {
    ensure: async (input, purpose = 'archive') => {
      const current = await store.active(input.taskId);
      if (current) { match(current, input); const e = await store.admit(current.id); return { id: e.id, state: e.state }; }
      const parent = await runtime.uow.read.environments.getById(input.taskId);
      if (!parent || parent.state !== 'releasing' || !input.volumeUid || !parent.render?.storageFinalization?.computeStopped || !runtime.sources.pinTaskImage) throw precondition('归档助手尚不能启动');
      if (runtime.taskVolumes && (await runtime.taskVolumes.forTask(input.taskId)).permit) throw precondition('原任务卷已经进入回收，不能再启动归档助手');
      const stopped = await runtime.workloadSafety?.scanStopped(input.taskId, { operationId: input.operationId, revision: input.revision }, 'business');
      if (stopped?.state !== 'complete' || !stopped.digest) throw precondition('原工作卷写者尚未确认停止');
      const image = await runtime.sources.pinTaskImage(runtime.settings.taskImage);
      if (!/^[^\s@]+@sha256:[a-f0-9]{64}$/.test(image)) throw precondition('归档助手镜像未固定摘要');
      const id = newResourceId(), now = runtime.clock.now().toISOString();
      const queued = await store.prepare({ ...input, id, purpose, volumeUid: input.volumeUid, namespace: parent.namespace, pvcName: parent.pvcName, podName: `archive-${id}`, consumerId: newResourceId(), image,
        workerUid: runtime.settings.workerUid, projectSlug: parent.labels['crewstation.io/project'] ?? '', serviceSlug: parent.labels['crewstation.io/service'] ?? '',
        state: 'queued', podUid: null, secretUid: null, expiresAt: null, createdAt: now, updatedAt: now });
      const admitted = await store.admit(queued.id); return { id: admitted.id, state: admitted.state };
    },
    stop: async (input) => { const e = await store.active(input.taskId); if (!e) return true; match(e, input); return stop(e); },
    values: async (id): Promise<Readonly<Record<string, string>>> => {
      const e = await requireExecution(id);
      if (e.state !== 'admitted' || !e.expiresAt || e.podUid || Date.parse(e.expiresAt) <= runtime.clock.now().getTime()) throw precondition('归档助手不再等待启动');
      if (e.purpose === 'binding') return {};
      const { token } = await credentials.issue({ id: e.id, bindingId: e.operationId, revision: e.revision, consumerId: e.consumerId, expiresAt: e.expiresAt });
      return { CS_ARCHIVE_URL: `${deps.apiUrl.replace(/\/$/, '')}/internal/archive-helpers/${id}`, CS_ARCHIVE_TOKEN: token };
    },
    bind: async (id, podUid, secretUid) => {
      const e = await requireExecution(id);
      if (e.purpose !== 'binding') await credentials.bind(id, podUid);
      await store.bind(id, podUid, secretUid);
    },
    reconcile: async () => {
      const page = await store.list(after); after = page.length === 50 ? page.at(-1)!.id : undefined;
      for (const e of page) {
        try {
          await runtimeBackground(runtime.projectWork, 'archive', 'task', e.taskId, async () => {
            if (e.state === 'stopping') { await stop(e); return; }
            if (e.state !== 'admitted') return;
            const record = await store.record(e.id), pod = record?.children?.find((child) => child.kind === 'Pod');
            const terminated = pod?.uid && ['Succeeded', 'Failed'].includes(pod.phase) || e.podUid && pod?.phase === 'absent';
            if (terminated || e.expiresAt && runtime.clock.now().getTime() >= Date.parse(e.expiresAt) - 10 * 60_000) await stop(e);
          }, undefined);
        } catch (error) { runtime.logger.warn('archive execution reconciliation pending', { id: e.id, error: error instanceof Error ? error.message : String(error) }); }
      }
    },
  };
}
