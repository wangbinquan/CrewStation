import type { WorkloadConsumer, WorkloadStartPermit } from '@crewstation/contracts';
import { DevelopmentUsageStorageSchema, DevelopmentRemovalProtectionSchema, WorkloadConsumerIntentSchema, WorkloadStartPermitSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';
import type { LedgerRecord } from '../../../domain/record';

type Fields = Readonly<Record<string, unknown>>;
const fields = (value: unknown): value is Fields => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const blocked = (record: LedgerRecord) => record.desired !== 'present' || record.conditions.some((c) => ['Failed', 'Paused', 'ReleasePending'].includes(c.type) && c.status === 'true');
const pending = () => precondition('原开发工作区和工作卷的首次观测尚未完成', { code: 'development_workload_pending' });
const changed = () => precondition('原开发工作区或工作卷实例已变化', { code: 'workspace_volume_changed' });

/** Missing open Agent records never downgrade a retained development consumer to the business path. */
export function needsDevelopmentOwnerCheck(record: LedgerRecord | undefined, parent: LedgerRecord | undefined, consumer: WorkloadConsumer): boolean {
  const pod = record?.spec['pod'];
  return parent?.kind === 'dev-workspace' || record?.purpose === 'development-agent' || fields(pod) && pod['developmentUsageProtection'] !== undefined
    || consumer.purpose === 'agent' && (!record || !parent);
}

function originalPod(record: LedgerRecord, parent: LedgerRecord, consumer: WorkloadConsumer): Fields {
  const pod = record.spec['pod'];
  const declared = record.spec.children, resources = fields(pod) && fields(pod['resources']) ? pod['resources'] : undefined;
  if (!fields(pod) || !DevelopmentUsageStorageSchema.safeParse(pod['developmentUsageProtection']).success || !DevelopmentUsageStorageSchema.safeParse(pod['developmentUsageStorage']).success
    || record.spec['workloadConsumerId'] !== consumer.id || pod['workload'] !== 'dev-session'
    || !text(pod['image']) || !Number.isSafeInteger(pod['workerUid']) || (pod['workerUid'] as number) <= 0 || !resources
    || !['cpu', 'memory', 'storage'].every((k) => text(resources[k])) || !text(pod['pvc']) || !text(pod['secret']) || !text(pod['nodeName'])
    || ['businessStorage', 'archive', 'checkout', 'emptyDir'].some((k) => pod[k] !== undefined)
    || !fields(pod['labels']) || pod['labels']['crewstation.io/workspace-task'] !== parent.id
    || !fields(pod['annotations']) || !/^[0-9a-f]{64}$/.test(String(pod['annotations']['crewstation.io/cli-intent'] ?? ''))
    || !fields(pod['workspace']) || !text(pod['workspace']['pod']) || !WorkloadStartPermitSchema.shape.podUid.safeParse(pod['workspace']['podUid']).success
    || pod['workspace']['pvcUid'] !== consumer.volumeUid || pod['expectedVolumeUid'] !== consumer.volumeUid) throw conflict('开发工作卷保护快照不完整或冲突');
  if (pod['developmentRemovalProtection'] !== undefined && !DevelopmentRemovalProtectionSchema.safeParse(pod['developmentRemovalProtection']).success) throw conflict('开发准入回执选择无效');
  const intent = WorkloadConsumerIntentSchema.safeParse(pod['consumer']);
  const { resourceId: _resource, namespace: _namespace, podName: _name, volumeUid: _volume, ...expected } = consumer;
  if (!intent.success || jsonHash(intent.data) !== jsonHash(expected)) throw conflict('开发工作卷消费者或启动修订已变化');
  const names = [['Pod', consumer.podName], ['Secret', pod['secret']], ['Secret', consumer.podName + '-admission']];
  if (declared.length !== 3 || !names.every(([kind, name]) => declared.some((c) => c.kind === kind && c.name === name && c.namespace === consumer.namespace))) throw conflict('开发执行子对象归属不完整');
  return pod;
}

function assertOriginalWorkspace(parent: LedgerRecord, volume: LedgerRecord | undefined, pod: Fields, consumer: WorkloadConsumer): void {
  const workspace = pod['workspace'] as Fields;
  const expectedPod = parent.spec.children.find((c) => c.kind === 'Pod' && c.namespace === consumer.namespace && c.name === workspace['pod']);
  if (!expectedPod || !volume || volume.owner.module !== 'task-runtime' || volume.owner.ref !== parent.id + '/work' || volume.parentId !== parent.id
    || volume.projectId !== parent.projectId || blocked(volume) || volume.spec['taskStorage'] !== undefined
    || !volume.spec.children.some((c) => c.kind === 'PersistentVolumeClaim' && c.namespace === consumer.namespace && c.name === pod['pvc'])) throw changed();
  const observedPod = parent.children.find((c) => c.kind === 'Pod' && c.namespace === consumer.namespace && c.name === expectedPod.name);
  const observedVolume = volume.children.find((c) => c.kind === 'PersistentVolumeClaim' && c.namespace === consumer.namespace && c.name === pod['pvc']);
  if (!observedPod?.uid || !observedVolume?.uid) throw pending();
  if (observedPod.uid !== workspace['podUid'] || observedPod.phase !== 'Running' || observedPod.node !== pod['nodeName']
    || observedVolume.uid !== consumer.volumeUid || observedVolume.phase !== 'Bound') throw changed();
}

/** Reads only resources-owned records under the original storage-task transaction lock. */
export function assertDevelopmentConsumerOwner(record: LedgerRecord | undefined, parent: LedgerRecord | undefined, volume: LedgerRecord | undefined, consumer: WorkloadConsumer, permit?: Omit<WorkloadStartPermit, 'grantedAt'>): void {
  if (!record || !parent || blocked(record) || blocked(parent)) throw precondition('开发执行资源已不可准入', { code: 'workload_admission_closed' });
  if (parent.kind !== 'dev-workspace' || record.kind !== 'agent-execution' || record.purpose !== 'development-agent' || consumer.purpose !== 'agent' || consumer.finalization !== null
    || record.owner.module !== 'task-runtime' || parent.owner.module !== 'task-runtime' || record.owner.ref !== record.id || parent.owner.ref !== parent.id
    || !parent.projectId || record.projectId !== parent.projectId || record.parentId !== parent.id || record.id === parent.id) throw conflict('开发工作卷消费者归属不匹配');
  const pod = originalPod(record, parent, consumer);
  assertOriginalWorkspace(parent, volume, pod, consumer);
  if (!permit) return;
  if (pod['expectedPodUid'] === undefined) throw precondition('等待原开发子 Pod 实际绑定', { code: 'development_workload_binding_pending' });
  if (!WorkloadStartPermitSchema.shape.podUid.safeParse(pod['expectedPodUid']).success || permit.podUid !== pod['expectedPodUid'] || permit.nodeName !== pod['nodeName']
    || !WorkloadStartPermitSchema.shape.podUid.safeParse(permit.nodeUid).success) throw conflict('开发启动许可不属于已绑定的原 Pod 或节点');
}
