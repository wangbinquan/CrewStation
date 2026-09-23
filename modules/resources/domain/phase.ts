import type { ResourceChild, ResourceCondition, ResourcePhase, ResourceReason } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { KindRule } from './kinds';
import { kindRule } from './kinds';
import type { LedgerRecord } from './record';
import { expectedChildren, isPresent } from './record';

/**
 * 阶段只由三类输入算出（RFC-025 设计 §2.3）：期望（要不要）、子对象观测、条件。
 * 任何人都不能直接写阶段：所属模块写期望与领域条件，资源中心写观测，阶段每次重算。
 */
export interface PhaseResult {
  readonly phase: ResourcePhase;
  readonly reason?: ResourceReason;
}

type PhaseInput = Pick<LedgerRecord, 'kind' | 'desired' | 'spec' | 'children' | 'conditions' | 'releaseReason'>;

const reasonOf = (code: string, message: string, hint?: string): ResourceReason => ({ code, message, ...(hint ? { hint } : {}) });
const STOPPING = reasonOf('stopping', '已受理释放，正在回收');
const PAUSING = reasonOf('pausing', '已暂停，正在回收容器');
const PAUSED = reasonOf('paused', '已暂停，工作卷保留；恢复后重新启动');
const QUEUED = reasonOf('queued', '已受理，排队等待分配');
const WAIT_CONNECT = reasonOf('waiting-connect', '容器已运行，等待环境连接');
const PENDING_RECLAIM = '工作卷待回收：上级已结束，由管理员确认后删除';

export function condition(record: Pick<LedgerRecord, 'conditions'>, type: string): ResourceCondition | undefined {
  return record.conditions.find((entry) => entry.type === type);
}

export function computePhase(record: PhaseInput): PhaseResult {
  const rule = kindRule(record.kind);
  const present = record.children.filter(isPresent);
  if (record.desired === 'absent') return present.length ? { phase: 'stopping', reason: record.releaseReason ?? STOPPING } : { phase: 'stopped', ...(record.releaseReason ? { reason: record.releaseReason } : {}) };
  // 待回收（D8）：工作卷的上级已结束，卷留着等管理员确认删除——它已不在用，按已结束算，不占什么也不算失败。
  const reclaim = condition(record, 'PendingReclaim');
  if (reclaim?.status === 'true') return { phase: 'stopped', reason: reasonOf(reclaim.reason ?? 'pending-reclaim', reclaim.message ?? PENDING_RECLAIM) };
  const failed = condition(record, 'Failed');
  if (failed?.status === 'true') return { phase: 'failed', reason: reasonOf(failed.reason ?? 'failed', failed.message ?? '平台判定失败') };
  if (condition(record, 'Paused')?.status === 'true') return present.length ? { phase: 'stopping', reason: PAUSING } : { phase: 'stopped', reason: PAUSED };
  // 不该有工作负载（服务槽已下线、尚未部署，设计 §4.3、D13）：期望仍在，只是此刻不运行——与暂停同一规则，原因照条件写。
  const serving = condition(record, 'Serving');
  if (serving?.status === 'false') {
    const reason = reasonOf(serving.reason ?? 'not-serving', serving.message ?? '当前没有运行的工作负载');
    return present.length ? { phase: 'stopping', reason } : { phase: 'stopped', reason };
  }
  if (!rule.primaryChild) return byConditions(record, rule);
  const primary = expectedChildren(record).find((child) => child.kind === rule.primaryChild);
  if (!primary || !isPresent(primary)) return condition(record, 'Prepared')?.status === 'false' ? { phase: 'pending', reason: QUEUED } : { phase: 'provisioning' };
  if (rule.primaryChild === 'PersistentVolumeClaim') return volumePhase(primary);
  return rule.primaryChild === 'Deployment' ? deploymentPhase(record, primary) : workloadPhase(record, rule, primary);
}

/**
 * Deployment → 阶段：观测把它归成 Available（副本都就绪且是新版本）、Progressing（还在铺新版本）、Unready（铺完后副本没全就绪）、
 * Stalled（推进超时）、ScaledDown（副本为 0）。资源中心判定槽的 Pod 在崩溃重启（条件 CrashLooping）时，副本眼下都就绪也是降级（设计 §4.3）。
 */
function deploymentPhase(record: PhaseInput, deployment: ResourceChild): PhaseResult {
  const looping = condition(record, 'CrashLooping');
  if (looping?.status === 'true') return { phase: 'degraded', reason: reasonOf('crash-looping', looping.message ?? '容器反复重启') };
  if (deployment.phase === 'Available') return { phase: 'ready' };
  if (deployment.phase === 'Unready') return { phase: 'degraded', reason: reasonOf('pods-unready', deployment.reason ?? '副本没有全部就绪') };
  if (deployment.phase === 'Stalled') return { phase: 'degraded', reason: reasonOf('rollout-stalled', deployment.reason ?? '部署停止推进') };
  if (deployment.phase === 'ScaledDown') return { phase: 'degraded', reason: reasonOf('scaled-down', deployment.reason ?? '副本数为 0') };
  return { phase: 'starting', ...(deployment.reason ? { reason: reasonOf('rolling-out', deployment.reason) } : {}) };
}

function workloadPhase(record: PhaseInput, rule: KindRule, pod: ResourceChild): PhaseResult {
  if (pod.phase === 'Failed' || pod.phase === 'Succeeded') {
    const summary = pod.phase === 'Failed' ? '容器运行失败' : '容器已退出';
    return { phase: 'degraded', reason: reasonOf(pod.phase === 'Failed' ? 'pod-failed' : 'pod-exited', pod.reason ? `${summary}：${pod.reason}` : summary) };
  }
  if (pod.phase !== 'Running' || !pod.ready) return { phase: 'starting', ...(pod.reason ? { reason: reasonOf('waiting-container', pod.reason) } : {}) };
  const unmet = rule.readyConditions.map((type) => ({ type, entry: condition(record, type) })).filter(({ entry }) => entry?.status !== 'true');
  if (!unmet.length) return { phase: 'ready' };
  // 从没为真：还在启动；曾经为真、现在为假或未知：降级（例如 Runner 断开）。重建中的工作区按重新启动算。
  const rebuilding = condition(record, 'Rebuilding')?.status === 'true';
  const lost = unmet.find(({ entry }) => entry !== undefined);
  if (!lost || rebuilding) return { phase: 'starting', reason: WAIT_CONNECT };
  return { phase: 'degraded', reason: reasonOf(`${lost.type}-${lost.entry!.status}`, lost.entry!.message ?? `${lost.type} 不成立`) };
}

function volumePhase(pvc: ResourceChild): PhaseResult {
  if (pvc.phase === 'Bound') return { phase: 'ready' };
  if (pvc.phase === 'Lost') return { phase: 'degraded', reason: reasonOf('volume-lost', pvc.reason ?? '工作卷的底层存储丢失') };
  return { phase: 'provisioning', ...(pvc.reason ? { reason: reasonOf('volume-pending', pvc.reason) } : {}) };
}

function byConditions(record: PhaseInput, rule: KindRule): PhaseResult {
  const unmet = rule.readyConditions.filter((type) => condition(record, type)?.status !== 'true');
  return unmet.length ? { phase: 'provisioning' } : { phase: 'ready' };
}

/**
 * 失败从什么时候算：所属模块报的「失败」条件带着发生时刻（台账接上之前就失败的会话据此得到真实起点），
 * 否则是记录进入失败的时刻。
 */
function failedSince(record: LedgerRecord, phaseChanged: boolean, now: Date): Date {
  const failed = condition(record, 'Failed');
  if (failed?.status === 'true') return new Date(failed.since);
  return phaseChanged ? now : record.phaseSince;
}

/**
 * 重算阶段并收束随阶段变化的字段：阶段变了才换 phaseSince；失败时按种类写保留到期（D9：从失败的时刻起算，
 * 每次按条件重算），离开失败（重试、恢复）时清掉。返回同一对象表示没有变化。
 */
export function settlePhase(record: LedgerRecord, now: Date): LedgerRecord {
  const next = computePhase(record);
  const rule = kindRule(record.kind);
  const phaseChanged = next.phase !== record.phase;
  const retainUntil = next.phase === 'failed' && rule.failedRetentionMs ? new Date(failedSince(record, phaseChanged, now).getTime() + rule.failedRetentionMs) : undefined;
  const sameReason = jsonHash(next.reason ?? null) === jsonHash(record.reason ?? null);
  const sameRetention = (retainUntil?.getTime() ?? null) === (record.retainUntil?.getTime() ?? null);
  if (!phaseChanged && sameReason && sameRetention) return record;
  const { reason: _reason, retainUntil: _retain, ...rest } = record;
  return { ...rest, phase: next.phase, phaseSince: phaseChanged ? now : record.phaseSince, ...(next.reason ? { reason: next.reason } : {}), ...(retainUntil ? { retainUntil } : {}) };
}
