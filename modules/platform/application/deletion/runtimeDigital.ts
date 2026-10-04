import type { ProjectDeletionContext, ProjectDeletionSessionTransport, RunnerBusinessReceipt, TaskId } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import type { RuntimeStopProject } from '../../ports/runtimeStops';
import type { RuntimeSessionBinding, RuntimeSessionCopies } from '../../ports/runtimeSession';

async function drain(session: RuntimeSessionCopies, taskId: TaskId, receipt: RunnerBusinessReceipt, transport: ProjectDeletionSessionTransport | undefined): Promise<boolean> {
  let stored = await session.getBusinessExecution(taskId, receipt.executionId);
  if (!stored) throw precondition('原业务数字登记已改变');
  if (stored.receipt.phase !== 'finished') {
    if (!transport) return false;
    const { attempt, incarnation, payloadDigest } = stored.receipt;
    await session.send(transport, { id: newResourceId(), type: 'cancelBusinessExecution', executionId: receipt.executionId,
      registration: { attempt, incarnation, payloadDigest } });
    await session.send(transport, { id: newResourceId(), type: 'getBusinessExecution', executionId: receipt.executionId });
    stored = await session.getBusinessExecution(taskId, receipt.executionId);
    if (!stored) throw precondition('原业务停止回复没有实际数字登记');
  }
  if (stored.persistedThrough < stored.receipt.lastSequence) {
    if (!transport) return false;
    await session.send(transport, { id: newResourceId(), type: 'readBusinessExecutionEvents', executionId: receipt.executionId, after: stored.persistedThrough, limit: 5 });
    stored = await session.getBusinessExecution(taskId, receipt.executionId);
    if (!stored) throw precondition('原业务事件复制没有实际数字登记');
  }
  if (transport && stored.acknowledgedThrough < stored.persistedThrough)
    await session.send(transport, { id: newResourceId(), type: 'ackBusinessExecutionEvents', executionId: receipt.executionId, through: stored.persistedThrough });
  return stored.receipt.phase === 'finished' && stored.complete && stored.persistedThrough === stored.receipt.lastSequence;
}
/** Full original PG receipts establish scope; ordinary pending queues and disconnected transports cannot stand in for EOF. */
export function runtimeDigitalStops(project: RuntimeStopProject, bind: RuntimeSessionBinding) {
  return async (context: ProjectDeletionContext, environment: { readonly id: TaskId }) => {
    const taskId = TaskIdSchema.parse(environment.id), grant = await project.projectDeletionParticipantContext(context, 'session'), session = bind(grant, taskId);
    const development = await session.lookupDevelopmentUsage(taskId);
    if (development.kind !== 'absent') return { kind: 'waiting' as const, reason: '原开发数字登记需要其独立数字清理参与者' };
    const transports = await session.transports();
    if (transports.length > 1) return { kind: 'waiting' as const, reason: '原业务执行通道尚未唯一确定' };
    let after: string | null = null, complete = true;
    const seen = new Set<string>();
    for (;;) {
      const receipts = await session.originalBusiness(after);
      if (!receipts.length) break;
      for (const receipt of receipts) {
        if (seen.has(receipt.executionId)) throw precondition('原业务执行完整分页没有前进');
        seen.add(receipt.executionId); complete = await drain(session, taskId, receipt, transports[0]) && complete;
      }
      after = receipts.at(-1)!.executionId;
    }
    await project.assertProjectDeletionGrant(context);
    return complete ? { kind: 'ready' as const } : { kind: 'waiting' as const, reason: '等待原业务执行结束及全部原事件和数字复制到 PG' };
  };
}
