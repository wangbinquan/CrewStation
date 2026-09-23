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

export function condition(record: Pick<LedgerRecord, 'conditions'>, type: string): ResourceCondition | undefined {
  return record.conditions.find((entry) => entry.type === type);
}

export function computePhase(record: PhaseInput): PhaseResult {
  const rule = kindRule(record.kind);
  const present = record.children.filter(isPresent);
  if (record.desired === 'absent') return present.length ? { phase: 'stopping', reason: record.releaseReason ?? STOPPING } : { phase: 'stopped', ...(record.releaseReason ? { reason: record.releaseReason } : {}) };
  const failed = condition(record, 'Failed');
  if (failed?.status === 'true') return { phase: 'failed', reason: reasonOf(failed.reason ?? 'failed', failed.message ?? '平台判定失败') };
  if (condition(record, 'Paused')?.status === 'true') return present.length ? { phase: 'stopping', reason: PAUSING } : { phase: 'stopped', reason: PAUSED };
  if (!rule.primaryChild) return byConditions(record, rule);
  const primary = expectedChildren(record).find((child) => child.kind === rule.primaryChild);
  if (!primary || !isPresent(primary)) return condition(record, 'Prepared')?.status === 'false' ? { phase: 'pending', reason: QUEUED } : { phase: 'provisioning' };
  return rule.primaryChild === 'PersistentVolumeClaim' ? volumePhase(primary) : workloadPhase(record, rule, primary);
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
 * 重算阶段并收束随阶段变化的字段：阶段变了才换 phaseSince；进入「失败」时按种类写保留到期（D9），
 * 离开失败（重试、恢复）时清掉。返回同一对象表示没有变化。
 */
export function settlePhase(record: LedgerRecord, now: Date): LedgerRecord {
  const next = computePhase(record);
  const rule = kindRule(record.kind);
  const phaseChanged = next.phase !== record.phase;
  const retainUntil = next.phase === 'failed' ? record.retainUntil ?? (rule.failedRetentionMs ? new Date(now.getTime() + rule.failedRetentionMs) : undefined) : undefined;
  const sameReason = jsonHash(next.reason ?? null) === jsonHash(record.reason ?? null);
  const sameRetention = (retainUntil?.getTime() ?? null) === (record.retainUntil?.getTime() ?? null);
  if (!phaseChanged && sameReason && sameRetention) return record;
  const { reason: _reason, retainUntil: _retain, ...rest } = record;
  return { ...rest, phase: next.phase, phaseSince: phaseChanged ? now : record.phaseSince, ...(next.reason ? { reason: next.reason } : {}), ...(retainUntil ? { retainUntil } : {}) };
}
