import type { Logger } from '@crewstation/kernel';
import { volumeRenderOf, workloadRenderOf, workspaceUnchanged } from '../domain/workloadRender';
import type { ClusterWriter, Ensured, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView, WorkloadOwners } from '../ports/ledger';
import type { ObservationStats } from './observeChange';

export interface WorkloadApplyDeps {
  readonly ledger: LedgerObservations;
  readonly feed: ManagedObjectFeed;
  readonly cluster: ClusterWriter;
  readonly stats: ObservationStats;
  readonly logger: Logger;
  readonly retryMs?: number;
  /** 工作区容器的所属模块（task-runtime）：建 Runner Secret 时要内容、Pod 建出后记实例；不给就不建工作区容器。 */
  readonly workloads?: WorkloadOwners;
}

const conditionTrue = (record: LedgerRecordView, type: string): boolean => record.conditions.some((entry) => entry.type === type && entry.status === 'true');
/** 所属模块要资源中心建出容器（领域条件 Provisioning，I25）：创建中、还没绑定 Pod 实例；卷与 Pod 只在这时建，丢了不补建。 */
const provisioning = (record: LedgerRecordView): boolean => conditionTrue(record, 'Provisioning') && !conditionTrue(record, 'Failed');
const WAIT_MS = 2_000;

function applied(deps: WorkloadApplyDeps, record: LedgerRecordView, kind: string, target: { readonly namespace: string; readonly name: string }, outcome: Ensured | 'applied' | 'unchanged'): void {
  if (outcome !== 'applied' && (typeof outcome === 'string' || !outcome.created)) return;
  deps.stats.applied += 1;
  deps.logger.info('resource child applied', { resourceId: record.id, kind, namespace: target.namespace, name: target.name, reason: 'missing' });
}

/**
 * 工作卷（RFC-025 I25）：所属模块要建出容器时，PVC 不在就照期望建。观测到过的卷没了不补建——换成一个空卷会让数据悄悄消失，
 * 等工作区自己因卷不在而起不来、被判失败。
 */
export async function applyVolume(deps: WorkloadApplyDeps, record: LedgerRecordView, enqueue: (id: string, afterMs?: number) => void): Promise<void> {
  if (!provisioning(record)) return;
  const volume = volumeRenderOf(record.spec);
  if (!volume) return;
  if (deps.feed.cached('PersistentVolumeClaim', volume.namespace, volume.name)) {
    // 卷进了观测缓存：上级工作区此刻就能建，不必等它的重试间隔。
    if (record.parentId) enqueue(record.parentId);
    return;
  }
  if (record.children.some((child) => child.kind === 'PersistentVolumeClaim' && child.name === volume.name && child.uid)) {
    deps.logger.warn('resource volume lost, not recreated', { resourceId: record.id, namespace: volume.namespace, name: volume.name });
    return;
  }
  applied(deps, record, 'PersistentVolumeClaim', volume, await deps.cluster.ensureVolume(volume));
}

/**
 * 工作区的容器（RFC-025 I25）：所属模块要建出时，等工作卷在了，先建这一次启动的 Runner Secret 与检出用的 Git 凭据（内容此刻向 task-runtime
 * 要，值不落库），再建 Pod（环境只从 Secret 引用）与开发预览，最后把 Pod 实例交回 task-runtime。已在的对象不动；
 * 建不成的抛出，工作队列按退避重试，原因写进记录（Created 为假），页面照标准记录显示。
 */
export async function applyWorkload(deps: WorkloadApplyDeps, record: LedgerRecordView, enqueue: (id: string, afterMs?: number) => void): Promise<void> {
  if (!provisioning(record) || !deps.workloads) return;
  const render = workloadRenderOf(record.id, record.spec);
  if (!render) {
    deps.logger.warn('resource workload spec incomplete', { resourceId: record.id });
    return;
  }
  const { pod, preview } = render, owners = deps.workloads, volume = pod.pvc ? deps.feed.cached('PersistentVolumeClaim', pod.namespace, pod.pvc) : undefined;
  // 执行环境（I25 第二步）：父工作区的 Pod 与卷要还是受理时那两个实例；没了或换了，交所属模块判失败、不建。
  if (pod.workspace && !workspaceUnchanged(pod, deps.feed.cached('Pod', pod.namespace, pod.workspace.pod), volume)) {
    deps.logger.warn('resource workload workspace changed', { resourceId: record.id, workspacePod: pod.workspace.pod });
    await owners.workloadUnavailable(record.id, 'workspace-changed');
    return;
  }
  // 档位测试（I25 第四步）用临时目录，不等卷。
  if (pod.pvc && !volume) {
    deps.logger.debug('resource workload waiting for volume', { resourceId: record.id, pvc: pod.pvc });
    enqueue(record.id, deps.retryMs ?? WAIT_MS);
    return;
  }
  try {
    const secret = await deps.cluster.ensureRunnerSecret(pod, () => owners.runnerValues(record.id));
    applied(deps, record, 'Secret', { namespace: pod.namespace, name: pod.secret }, secret);
    // 检出用的 Git 凭据归这一次启动（I25）：Pod 的 init 容器引用它，先于 Pod 建出。
    if (pod.checkout?.ownedCredential) applied(deps, record, 'Secret', { namespace: pod.namespace, name: pod.checkout.credentialSecretName }, await deps.cluster.ensureCheckoutSecret(pod, () => owners.checkoutValues(record.id)));
    const created = await deps.cluster.ensurePod(pod);
    applied(deps, record, 'Pod', pod, created);
    if (preview) applied(deps, record, 'Service', preview, await deps.cluster.applyPreview(preview, { ...optional('service', deps.feed.cached('Service', preview.namespace, preview.name)), ...optional('route', deps.feed.cached('IngressRoute', preview.namespace, preview.name)) }));
    await owners.bindWorkload(record.id, created.uid, secret.uid);
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'false', reason: 'create-failed', message: `容器没有建成：${message}`.slice(0, 2000) }]).catch(() => undefined);
    throw error;
  }
}

function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
