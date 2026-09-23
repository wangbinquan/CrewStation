import type { ResourceAction, ResourceActionId, ResourceKind } from '@crewstation/contracts';
import { kindRule } from './kinds';
import type { LedgerRecord } from './record';
import { condition } from './phase';

/** 各种类有哪些生命周期操作（RFC-025 提案 §5.1）；是否可做按阶段算，角色裁剪在模块接口里做。 */
const KIND_ACTIONS: Readonly<Partial<Record<ResourceKind, readonly ResourceActionId[]>>> = {
  'dev-workspace': ['release', 'retry'],
  'agent-execution': ['release', 'retry'],
  volume: ['delete-volume'],
};

type ActionInput = Pick<LedgerRecord, 'kind' | 'desired' | 'phase' | 'conditions'>;

export function actionsFor(record: ActionInput): ResourceAction[] {
  return (KIND_ACTIONS[record.kind] ?? []).map((id) => evaluate(id, record));
}

function evaluate(id: ResourceActionId, record: ActionInput): ResourceAction {
  const disabled = (disabledReason: string): ResourceAction => ({ id, enabled: false, disabledReason });
  if (id === 'release') {
    if (!kindRule(record.kind).releasable) return disabled('这类资源不能在这里释放');
    if (record.desired === 'absent' || record.phase === 'stopping') return disabled('已受理释放，正在回收');
    if (record.phase === 'stopped') return disabled('已经结束');
    return { id, enabled: true };
  }
  if (id === 'retry') return record.phase === 'failed' && record.desired === 'present' ? { id, enabled: true } : disabled('只有失败的才可以重试');
  if (id === 'delete-volume') return condition(record, 'PendingReclaim')?.status === 'true' ? { id, enabled: true } : disabled('只有待回收的工作卷可以删除');
  return disabled('暂不支持');
}
