import { WORKLOAD_CONSUMER_ANNOTATION } from '@crewstation/contracts';
import type { Clock, Logger } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import type { LedgerObservations, LedgerRecordView } from '../ports/ledger';
import type { ClusterWriter, ManagedObjectFeed } from '../ports/cluster';
import { workloadRenderOf } from '../domain/workloadRender';

export interface WorkloadSafetyDeps {
  ledger: Pick<LedgerObservations, 'workloadSafety' | 'observeConditions'>;
  cluster: Pick<ClusterWriter, 'observeWorkloadStop' | 'releaseWorkloadStop'>;
  feed: Pick<ManagedObjectFeed, 'cached'>;
  clock: Clock; logger: Logger; retryMs?: number;
}

/** Stop evidence is committed before removing the finalizer; failure keeps the protected Pod inspectable. */
async function proveConsumer(deps: WorkloadSafetyDeps, record: LedgerRecordView, id: string, pod: ObservedObject | undefined): Promise<boolean> {
  const safety = deps.ledger.workloadSafety;
  if (!safety || !deps.cluster.observeWorkloadStop || !deps.cluster.releaseWorkloadStop) throw new Error('工作卷停止证明能力未装配');
  let current = await safety.get(id);
  if (!current) {
    const intent = workloadRenderOf(record.id, record.spec)?.pod;
    if (intent?.consumer?.id === id && safety.closeAdmission) await safety.closeAdmission({ consumer: intent.consumer, resourceId: record.id, namespace: intent.namespace, podName: intent.name });
    if (!await safety.admissionClosed?.(id)) throw new Error('工作卷消费者记录不匹配');
    // Closure may have raced a register/grant after the first read. Read again after its durable ACK.
    current = await safety.get(id);
    if (!current && !pod) {
      await deps.ledger.observeConditions(record.id, [{ type: 'WorkloadStopped', status: 'true', reason: id }]); return true;
    }
    if (!current) throw new Error('封存的启动出现未登记 Pod');
  }
  if (current.consumer.resourceId !== record.id) throw new Error('工作卷消费者记录不匹配');
  current = await safety.closeConsumer(id);
  let proof = current.stopProof;
  if (!proof) {
    const observed = await deps.cluster.observeWorkloadStop(current.consumer, deps.clock.now());
    if (observed.state === 'blocked') {
      if (observed.code === 'pod_missing_without_stop_proof' && !current.startPermit) {
        await deps.ledger.observeConditions(record.id, [{ type: 'WorkloadStopped', status: 'true', reason: id }]); return true;
      }
      if (record.spec['workloadConsumerId'] === id) await deps.ledger.observeConditions(record.id, [{ type: 'WorkloadStopped', status: 'unknown', reason: observed.code, message: '尚未取得全部容器的停止证明，保留工作卷和并发占用' }]);
      return false;
    }
    proof = await safety.recordStop(observed.proof);
  }
  if (pod && pod.metadata.uid !== proof.podUid) throw new Error('消费者 Pod 已换成其他实例，拒绝复用旧停止证明');
  await deps.cluster.releaseWorkloadStop(proof);
  if (record.spec['workloadConsumerId'] === id) await deps.ledger.observeConditions(record.id, [{ type: 'WorkloadStopped', status: 'true', reason: id }]);
  return true;
}

export async function reconcileWorkloadSafety(deps: WorkloadSafetyDeps, record: LedgerRecordView, enqueue: (id: string, afterMs?: number) => void): Promise<void> {
  const ids = new Map<string, ObservedObject | undefined>();
  const current = typeof record.spec['workloadConsumerId'] === 'string' ? record.spec['workloadConsumerId'] : undefined;
  const stopping = record.desired === 'absent' || record.conditions.some((c) => ['Paused', 'Failed', 'ReleasePending'].includes(c.type) && c.status === 'true');
  if (current && stopping) ids.set(current, undefined);
  const names = new Map([...record.spec.children, ...record.children].filter((c) => c.kind === 'Pod').map((c) => [`${c.namespace}/${c.name}`, c]));
  for (const child of names.values()) {
    const pod = deps.feed.cached('Pod', child.namespace, child.name), id = pod?.metadata.annotations?.[WORKLOAD_CONSUMER_ANNOTATION];
    if (id && (stopping || pod?.metadata.deletionTimestamp || ['Failed', 'Succeeded'].includes((pod?.status as { phase?: string } | undefined)?.phase ?? ''))) ids.set(id, pod);
  }
  for (const [id, pod] of ids) {
    try { if (!await proveConsumer(deps, record, id, pod)) enqueue(record.id, deps.retryMs ?? 2_000); }
    catch (error) {
      await deps.ledger.observeConditions(record.id, [{ type: 'WorkloadStopped', status: 'unknown', reason: 'stop_proof_unavailable', message: '停止证明尚未持久确认，等待重试' }]);
      deps.logger.warn('workload stop proof pending', { resourceId: record.id, consumerId: id, error: String(error) });
      enqueue(record.id, deps.retryMs ?? 2_000);
    }
  }
}
