import type { ProjectDeletionOwner } from '@crewstation/contracts';
import type { ObservabilityDeletionRepository } from '../ports/projectDeletion';

/** 观测模块只持有数据库内容：封写后按项目删除告警、Agent 执行记录与费用可见性；运行源停止由运行 owner 证明。 */
export function observabilityDeletionOwner(repository: ObservabilityDeletionRepository): ProjectDeletionOwner {
  return { participant: 'observability', inspect: (target) => repository.inspect(target), run: async (context) => {
    if (context.phase === 'seal') {
      const sealed = await repository.seal(context);
      if (sealed === 'waiting') return { kind: 'waiting', reason: '等待本项目已开始的观测提交退出，其他项目可继续提交' };
      if (!sealed) return { kind: 'blocked', blockers: [{ participant: 'observability', code: 'observability-inventory-changed', message: '观测内容在确认后变化；已封写，需重新核对' }] };
    }
    const result = await repository.step(context);
    const metadata = ['seal', 'stop', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', count: metadata ? result.count : 0, digest: result.digest,
      description: context.phase === 'seal' ? '本项目观测写入持久封闭，已开始的提交已排空' : context.phase === 'stop'
        ? '本项目观测的待删范围已固定；运行源停止由独立 owner 证明' : context.phase === 'metadata' || context.phase === 'verify'
        ? '告警、Agent 执行记录（含按模型用量）与费用可见性已清除；价格线与平台执行保留'
        : '观测模块仅持有数据库内容；实际运行源停止及资源回收由运行 owner 证明' } };
  } };
}
