import type { Clock, Logger } from '@crewstation/kernel';
import type { ObservedObject } from '../domain/observation';
import { deploymentChild } from '../domain/observation';
import type { SlotRender } from '../domain/slotRender';
import { slotRenderOf } from '../domain/slotRender';
import type { ClusterWriter, Ensured, ManagedObjectFeed } from '../ports/cluster';
import type { LedgerObservations, LedgerRecordView, SlotOwners } from '../ports/ledger';
import type { ObservationStats } from './observeChange';

export interface SlotApplyDeps {
  readonly ledger: LedgerObservations;
  readonly feed: ManagedObjectFeed;
  readonly cluster: ClusterWriter;
  readonly clock: Clock;
  readonly stats: ObservationStats;
  readonly logger: Logger;
  /** 服务槽的所属模块（release）：建环境 Secret 时要内容；不给就不建服务槽。 */
  readonly slots?: SlotOwners;
}

const conditionOf = (record: LedgerRecordView, type: string) => record.conditions.find((entry) => entry.type === type);

function counted(deps: SlotApplyDeps, record: LedgerRecordView, kind: string, slot: SlotRender, name: string, outcome: Ensured | 'applied' | 'unchanged'): void {
  if (outcome === 'unchanged' || (typeof outcome !== 'string' && !outcome.created)) return;
  deps.stats.applied += 1;
  deps.logger.info('resource child applied', { resourceId: record.id, kind, namespace: slot.namespace, name, generation: record.generation });
}

async function removeCached(deps: SlotApplyDeps, record: LedgerRecordView, kind: 'Deployment' | 'Secret', namespace: string, name: string, cached: ObservedObject | undefined): Promise<void> {
  const uid = cached?.metadata.uid;
  if (!uid || cached.metadata.deletionTimestamp) return;
  await deps.cluster.remove({ kind, namespace, name, uid });
  deps.stats.removed += 1;
  deps.logger.info('resource child removed', { resourceId: record.id, kind, namespace, name, reason: kind === 'Deployment' ? 'not-serving' : 'env-superseded' });
}

/** 记录名下观测到的环境 Secret（期望里的、以及换版本前留下的旧的），keep 之外的都删。 */
async function removeSecrets(deps: SlotApplyDeps, record: LedgerRecordView, slot: SlotRender, keep?: string): Promise<void> {
  for (const child of record.children) {
    if (child.kind !== 'Secret' || child.name === keep || child.phase === 'absent') continue;
    await removeCached(deps, record, 'Secret', child.namespace ?? slot.namespace, child.name, deps.feed.cached('Secret', child.namespace ?? slot.namespace, child.name));
  }
}

/**
 * 槽此刻不该有工作负载（Serving 为假：下线、集群管理删除，RFC-021）：先按 UID 删 Deployment，它消失之后再删环境 Secret——里面是生产配置与密钥，
 * 下线的槽不留着它。Service 保留（下线保留 Service 与路由，路由改指说明页由路由记录负责）。
 */
async function retire(deps: SlotApplyDeps, record: LedgerRecordView, slot: SlotRender, deployment: ObservedObject | undefined): Promise<void> {
  if (deployment) {
    await removeCached(deps, record, 'Deployment', slot.namespace, slot.name, deployment);
    return;
  }
  await removeSecrets(deps, record, slot);
}

/**
 * 服务槽（RFC-025 T8）：release 写期望，调和器建出。先建这一次部署的环境 Secret（不可变，内容此刻向 release 要，值不落台账），再按期望应用
 * Service 与 Deployment（缺了或被改了就 apply；Deployment 带上渲染它的期望版本）。新版本铺完、副本都就绪之后，删掉换下来的旧环境 Secret。
 * 流水线已判失败的不再改（留着诊断，与 release 自己部署时一样）；旧形状（期望里没有 slot）不碰。建不成的写进记录（Created 为假），
 * 并交 release 判这一次部署失败（与它自己部署时 apply 失败即判失败一致，文案由它写）；抛出后工作队列按退避重试。
 */
export async function applySlot(deps: SlotApplyDeps, record: LedgerRecordView): Promise<void> {
  if (record.spec['slot'] === undefined) return;
  const slot = slotRenderOf(record.spec);
  if (!slot) {
    deps.logger.warn('resource slot spec incomplete', { resourceId: record.id });
    return;
  }
  const deployment = deps.feed.cached('Deployment', slot.namespace, slot.name);
  if (conditionOf(record, 'Serving')?.status === 'false') return retire(deps, record, slot, deployment);
  if (conditionOf(record, 'Failed')?.status === 'true' || !deps.slots) return;
  const owners = deps.slots;
  const ref = { recordId: record.id, serviceId: slot.serviceId, physical: slot.physical, releaseId: slot.releaseId, revision: slot.revision };
  try {
    counted(deps, record, 'Secret', slot, slot.secret, await deps.cluster.ensureSlotSecret(slot, () => owners.slotEnvValues(ref)));
    counted(deps, record, 'Service', slot, slot.name, await deps.cluster.applySlotService(slot, deps.feed.cached('Service', slot.namespace, slot.name)));
    const outcome = await deps.cluster.applySlotDeployment(slot, record.generation, deployment);
    counted(deps, record, 'Deployment', slot, slot.name, outcome);
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'true' }]);
    const observed = deployment && outcome === 'unchanged' ? deploymentChild(deployment, deps.clock.now().toISOString()) : undefined;
    if (observed?.phase === 'Available' && observed.appliedGeneration === record.generation) await removeSecrets(deps, record, slot, slot.secret);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.ledger.observeConditions(record.id, [{ type: 'Created', status: 'false', reason: 'create-failed', message: `服务槽没有建成：${message}`.slice(0, 2000) }]).catch(() => undefined);
    await owners.slotFailed(ref, message).catch((reported: unknown) => deps.logger.warn('resource slot failure report failed', { resourceId: record.id, error: String(reported) }));
    throw error;
  }
}
