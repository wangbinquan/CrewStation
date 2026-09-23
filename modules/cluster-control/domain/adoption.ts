import type { AdoptionItem, AdoptionVerdict, ResourceKind } from '@crewstation/contracts';
import type { ObservedObject } from './observation';
import { RESOURCE_ID_LABEL } from './observation';

/** 旧的所属对象：按 Pod／PVC 上的 `crewstation.io/task` 标签从 task-runtime 查到的任务环境。 */
export interface LegacyTask {
  readonly kind: 'dev-session' | 'business' | 'profile-test';
  readonly state: 'creating' | 'running' | 'paused' | 'releasing' | 'released' | 'failed';
  /** 是 Agent 执行环境（「＋ CLI」、headless Agent、业务子任务），不是工作区本身。 */
  readonly execution: boolean;
}

export interface AdoptionInput {
  readonly object: ObservedObject;
  /** 台账里认领它的记录（按资源标签或期望的子对象身份）。 */
  readonly claimedBy?: string;
  /** 按任务标签查到的任务环境；标签在但查不到时是 'missing'。 */
  readonly legacyTask?: LegacyTask | 'missing';
}

const TASK_LABEL = 'crewstation.io/task';
const LIVE_TASK_STATES: readonly LegacyTask['state'][] = ['creating', 'running', 'paused', 'releasing'];

function taskCandidate(object: ObservedObject, task: LegacyTask): ResourceKind {
  if (object.kind === 'PersistentVolumeClaim') return 'volume';
  if (task.execution || task.kind === 'profile-test') return 'agent-execution';
  return task.kind === 'dev-session' ? 'dev-workspace' : 'business-workspace';
}

function byTask(object: ObservedObject, taskId: string, task: LegacyTask | 'missing' | undefined): Omit<AdoptionItem, 'kind' | 'name'> {
  const volumeNote = object.kind === 'PersistentVolumeClaim' ? '；工作卷只进入待回收，由管理员确认后删除' : '';
  if (!task || task === 'missing') return { verdict: 'orphan', owner: 'task-runtime', ownerRef: taskId, reason: `任务环境 ${taskId} 的记录已不存在${volumeNote}` };
  if (LIVE_TASK_STATES.includes(task.state)) return { verdict: 'adoptable', candidateKind: taskCandidate(object, task), owner: 'task-runtime', ownerRef: taskId, reason: `任务环境 ${taskId} 仍在（${task.state}），收编时生成记录并认领` };
  if (task.state === 'failed' && task.kind === 'dev-session' && !task.execution) return { verdict: 'retained', candidateKind: taskCandidate(object, task), owner: 'task-runtime', ownerRef: taskId, reason: '失败的开发会话按 72 小时保留供诊断，到期后回收' };
  return { verdict: 'orphan', owner: 'task-runtime', ownerRef: taskId, reason: `任务环境 ${taskId} 已${task.state === 'failed' ? '失败' : '释放'}，对象仍在${volumeNote}` };
}

/** 服务槽、构建与迁移的 Pod：第三期由槽与 Job 的记录认领。 */
function byRelease(labels: Readonly<Record<string, string>>): Omit<AdoptionItem, 'kind' | 'name'> | undefined {
  const component = labels['app.kubernetes.io/component'];
  if (component === 'build') return { verdict: 'adoptable', candidateKind: 'build-job', owner: 'release', reason: '构建 Job 的 Pod，第三期由构建记录认领' };
  if (component === 'migration') return { verdict: 'adoptable', candidateKind: 'migration-job', owner: 'release', reason: '迁移 Job 的 Pod，第三期由迁移记录认领' };
  if (labels['crewstation.io/workload'] === 'service' || labels['crewstation.io/release']) {
    return { verdict: 'adoptable', candidateKind: 'service-slot', owner: 'release', ...(labels['crewstation.io/release'] ? { ownerRef: labels['crewstation.io/release'] } : {}), reason: '服务槽的 Pod，第三期由槽记录认领' };
  }
  return undefined;
}

/** 收编空跑的判定（设计 §6.5）：只算结论，不改集群、不写台账。 */
export function classifyObject(input: AdoptionInput): AdoptionItem {
  const { object } = input;
  const labels = object.metadata.labels ?? {};
  const identity = { kind: object.kind, ...(object.metadata.namespace ? { namespace: object.metadata.namespace } : {}), name: object.metadata.name, ...(object.metadata.uid ? { uid: object.metadata.uid } : {}) };
  if (input.claimedBy) return { ...identity, verdict: 'owned', resourceId: input.claimedBy, reason: '已由资源记录认领' };
  if (labels[RESOURCE_ID_LABEL]) return { ...identity, verdict: 'orphan', resourceId: labels[RESOURCE_ID_LABEL], reason: '带资源标签，但台账里没有记录认领它' };
  const taskId = labels[TASK_LABEL];
  if (taskId) return { ...identity, ...byTask(object, taskId, input.legacyTask) };
  return { ...identity, ...(byRelease(labels) ?? { verdict: 'unclassified', reason: '没有可识别的归属标签' }) };
}

export function countVerdicts(items: readonly AdoptionItem[]): Record<AdoptionVerdict, number> {
  const counts: Record<AdoptionVerdict, number> = { owned: 0, adoptable: 0, orphan: 0, retained: 0, unclassified: 0 };
  for (const item of items) counts[item.verdict] += 1;
  return counts;
}
