import type { ProjectDeletionContext, ProjectDeletionOwner } from '@crewstation/contracts';
import type { ObservabilityDeletionRepository } from '../ports/projectDeletion';

export function observabilityDeletionOwner(repository: ObservabilityDeletionRepository, drain?: (context: ProjectDeletionContext) => Promise<void>): ProjectDeletionOwner {
  return { participant: 'observability', inspect: (target) => repository.inspect(target), run: async (context) => {
    if (context.phase === 'seal') {
      const sealed = await repository.seal(context);
      if (sealed === 'waiting') return { kind: 'waiting', reason: '等待本项目已开始的观测提交退出，其他项目可继续提交' };
      if (!sealed) return { kind: 'blocked', blockers: [{ participant: 'observability', code: 'observability-inventory-changed', message: '观测内容或归属在确认后变化；已封写，需重新核对' }] };
    }
    if (context.phase === 'stop' && drain && await repository.needsDrain(context)) await drain(context);
    const result = await repository.step(context);
    if(result==='waiting')return {kind:'waiting',reason:'等待完整报告构建退出并清理派生缓存'};
    const metadata = ['seal', 'stop', 'metadata', 'verify'].includes(context.phase);
    return { kind: 'done', evidence: { kind: metadata ? 'metadata' : 'not-applicable', count: metadata ? result.count : 0, digest: result.digest,
      description: context.phase === 'seal' ? '本项目观测写入持久封闭，原 SQL 提交已排空' : context.phase === 'stop'
        ? '原观测数值页与计价提交完成，最终数据库范围封存；运行源停止由独立 owner 证明' : context.phase === 'metadata' || context.phase === 'verify'
        ? '用量、计价、原生证据、告警、可见性与派生报告缓存清除；平台价格目录和其他项目原始数据保留'
        : '观测模块仅持有数据库内容；实际运行源停止及资源回收由运行 owner 证明' } };
  } };
}
