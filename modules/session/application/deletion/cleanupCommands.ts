import { ProjectDeletionContextSchema, ResourceIdSchema, RunnerCommandSchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, RunnerCommand } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import { sessionCleanupCommand } from '../../domain/deletion/cleanupCommand';
import type { SessionDeletionRepository, SessionDeletionSources } from '../../ports/projectDeletion';
import type { SessionProjectWork } from '../../ports/projectWork';
import type { SessionUseCaseDeps } from '../dependencies';
import type { RunnerHub } from '../runnerHub';
import { sendRunnerWire } from '../commandWire';
import { assertLaunchSupported } from '../../domain/runtimeNegotiation';
import { persistSessionCleanupReply } from './cleanupReply';

type Deps = Pick<SessionUseCaseDeps, 'clock'> & {
  readonly businessExecutions: NonNullable<SessionUseCaseDeps['businessExecutions']>;
  readonly developmentUsage: NonNullable<SessionUseCaseDeps['developmentUsage']>;
  readonly projectWork: SessionProjectWork;
};
export async function originalSessionCleanup(repository: SessionDeletionRepository, sources: SessionDeletionSources,
  raw: ProjectDeletionContext, consumerId: string) {
  const context = ProjectDeletionContextSchema.parse(structuredClone(raw));
  if (context.phase !== 'stop' || context.confirmed.participant !== 'session') throw precondition('会话清理只接受 Session 当前 stop 许可');
  await sources.assertGrant(context);
  const scope = await repository.scope(context);
  if (await repository.proof(context)) throw precondition('会话停止阶段已经完成，不能再派发命令');
  const birth = scope.births.find((entry) => entry.id === ResourceIdSchema.parse(consumerId));
  if (!birth || await repository.exited(birth)) throw precondition('会话清理缺少仍在使用的原连接出生');
  return { context, birth };
}
export function sessionCleanupCommands(repository: SessionDeletionRepository, sources: SessionDeletionSources,
  deps: Deps, hub: Pick<RunnerHub, 'connections' | 'withOriginal'>, address: string) {
  return async (raw: ProjectDeletionContext, consumerId: string, requested: RunnerCommand): Promise<unknown> => {
    const { context, birth } = await originalSessionCleanup(repository, sources, raw, consumerId);
    if (birth.replica !== address) throw precondition('会话清理命令不属于本副本的原连接');
    const command = RunnerCommandSchema.parse(structuredClone(requested));
    return hub.withOriginal(birth, (connection) => deps.projectWork.runGranted(context,
      { taskKey: birth.taskId, kind: 'cleanup', reference: command.id, inputDigest: jsonHash(command) }, async (handle) => {
        const development = await deps.developmentUsage.lookup(birth.taskId);
        const business = 'executionId' in command && typeof command.executionId === 'string' ? await deps.businessExecutions.get(birth.taskId, command.executionId) : undefined;
        const original = { projectId: context.target.id, taskId: birth.taskId,
          development: development.kind === 'registered' ? development.stored : undefined, business };
        const validated = sessionCleanupCommand(command, original);
        assertLaunchSupported(validated, connection.hello.capabilities);
        const payload = await handle.retain(() => sendRunnerWire(connection, validated, deps.clock, () => hub.connections.get(birth.taskId) === connection));
        await persistSessionCleanupReply(deps.businessExecutions, deps.developmentUsage, birth.taskId, validated, original, payload);
        await handle.check(); return payload;
      }, connection.command.bind(connection)));
  };
}
