import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionEvidence, ProjectDeletionOwner } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { SessionConnectionBirth, SessionDeletionRepository, SessionDeletionSources, SessionDeletionTransport } from '../ports/projectDeletion';

export function sessionDeletionOwner(repository: SessionDeletionRepository, transport: SessionDeletionTransport, sources: SessionDeletionSources): ProjectDeletionOwner {
  const run: ProjectDeletionOwner['run'] = async (raw) => {
    const context = ProjectDeletionContextSchema.parse(raw);
    if (context.confirmed.participant !== 'session' || !context.confirmed.complete || context.confirmed.blockers.length || context.confirmed.references.length)
      throw precondition('会话清理缺少完整原确认');
    await sources.assertGrant(context);
    if (context.phase === 'seal') {
      try {
        if (!(await repository.seal(context))) return { kind: 'blocked', blockers: [{ participant: 'session', code: 'inventory-changed', message: '会话内容在确认后发生变化，准入已封闭，需要重新确认' }] };
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '55P03') return { kind: 'waiting', reason: '等待原握手退出准入锁' };
        throw error;
      }
    }
    const previous = await repository.proof(context);
    if (previous) return { kind: 'done', evidence: previous };
    const scope = await repository.scope(context);
    if (context.phase === 'stop') await repository.observe();
    if (context.phase === 'stop') for (const birth of scope.births) {
      if (!(await repository.exited(birth))) {
        await transport.close(context, birth);
        if (!(await repository.exited(birth))) return { kind: 'waiting', reason: '等待原副本关闭连接与命令，并记录私有 finally；失联不算退出' };
      }
    }
    if (context.phase === 'metadata') await repository.purge(context);
    if (context.phase === 'verify' && (await repository.inspect(context.target)).scope.count !== 0)
      return { kind: 'blocked', blockers: [{ participant: 'session', code: 'content-remains', message: '完整分页仍有会话内容，不能完成清理' }] };
    const evidence: ProjectDeletionEvidence = { kind: context.phase === 'namespace' ? 'not-applicable' : 'metadata', count: context.phase === 'namespace' ? 0 : scope.count,
      digest: jsonHash({ operationId: context.operationId, phase: context.phase, scope: scope.digest }),
      description: context.phase === 'stop' ? '原消息与命令回调退出，已保存私有 finally 或原受保护 Pod 全部容器的实际停止证明'
        : context.phase === 'namespace' ? '会话数据位于共享控制面；任务容器和存储由对应资源 owner 清理'
          : context.phase === 'metadata' ? '会话十类内容和原连接记录已删除，清理范围仅保留数量与摘要'
            : '会话准入已封闭，完整原范围与持久阶段证明已核对' };
    await sources.assertGrant(context); await repository.record(context, evidence);
    return { kind: 'done', evidence };
  };
  return { participant: 'session', inspect: async (target) => {
    try { return (await repository.inspect(target)).inventory; }
    catch (error) { return { participant: 'session', complete: false, resources: [], references: [], revision: jsonHash({ project: target.id, unavailable: true }),
      blockers: [{ participant: 'session', code: 'source-unavailable', message: error instanceof Error ? error.message.slice(0, 500) : '会话原来源未完成' }] }; }
  }, run };
}

/** Narrow internal cleanup endpoint: it uses the confirmed birth, never a task ID or the latest replica as authority. */
export function sessionTransportCloser(repository: SessionDeletionRepository, sources: SessionDeletionSources,
  local: (birth: SessionConnectionBirth) => Promise<boolean>, address: string) {
  return async (context: ProjectDeletionContext, consumerId: string): Promise<boolean> => {
    const parsed = ProjectDeletionContextSchema.parse(context);
    if (parsed.phase !== 'stop' || parsed.confirmed.participant !== 'session') throw precondition('会话关闭只接受原 stop 许可');
    await sources.assertGrant(parsed);
    const scope = await repository.scope(parsed);
    await repository.proof(parsed);
    const birth = scope.births.find((entry) => entry.id === consumerId);
    if (!birth || birth.replica !== address) throw precondition('会话原副本或出生不符');
    if (await repository.exited(birth)) return true;
    await local(birth); await sources.assertGrant(parsed);
    return repository.exited(birth);
  };
}
