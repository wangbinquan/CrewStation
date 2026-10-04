import { TaskIdSchema } from '@crewstation/contracts';
import { isPlatformError, jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { RuntimeDeletionStop } from '../../ports/deletion/projectDeletion';
import type { RuntimeOriginalJobs, RuntimeOriginalStopSources } from '../../ports/deletion/originalStop';
import type { RuntimeProjectWork } from '../../ports/deletion/work';
import type { NativeExecutionDeps } from '../nativeExecution';
import { stopOriginalEnvironment } from './stopEnvironment';

/** Resume every frozen original task without handing it to the sealed ordinary worker or reclaiming its volume. */
export function runtimeOriginalStop(deps: NativeExecutionDeps, work: RuntimeProjectWork, jobs: RuntimeOriginalJobs, sources: RuntimeOriginalStopSources): RuntimeDeletionStop {
  return { stop: async (context, scope) => {
    if (context.phase !== 'stop' || context.confirmed.participant !== 'task-runtime') throw precondition('原运行停止只接受 task-runtime 当前停止许可');
    const tasks = scope.contents.filter((item) => item.table === 'environments').map((item) => {
      const key = JSON.parse(item.key) as unknown;
      if (!Array.isArray(key) || key.length !== 1) throw precondition('原环境主键确认范围无效');
      return TaskIdSchema.parse(key[0]);
    });
    if (new Set(tasks).size !== tasks.length) throw precondition('原环境确认范围出现重复身份');
    const proofs: Array<{ id: string; digest: string }> = [], waiting: string[] = [];
    for (const taskId of tasks) {
      try {
      const result = await work.runGranted(context, { originKind: 'task', originKey: taskId, reference: newResourceId(),
        inputDigest: jsonHash({ scope: scope.digest, taskId, operationId: context.operationId }) }, async () => {
        const env = await deps.uow.read.environments.getById(taskId);
        if (!env || env.projectId !== context.target.id) throw precondition('原确认环境缺失或跨项目');
        // A finished original needs no queue row or physical mutation; its independent stop proof remains mandatory.
        if (!env.native || env.native.state === 'finished') return { claimed: true as const, value: await stopOriginalEnvironment(deps, sources, context, env, undefined, async () => true) };
        return jobs.run(context, taskId, (identity, heartbeat) => stopOriginalEnvironment(deps, sources, context, env, identity, heartbeat));
      });
      if (!result.claimed) waiting.push(taskId + ': 等待原作业租约或原持久作业来源');
      else if ('waiting' in result.value) waiting.push(taskId + ': ' + result.value.waiting);
      else proofs.push({ id: taskId, digest: result.value.digest });
      } catch (error) {
        if (!isPlatformError(error) || error.details.code !== 'runtime_original_stop_waiting') throw error;
        waiting.push(taskId + ': ' + error.message);
      }
    }
    if (waiting.length) return { kind: 'waiting', reason: waiting.slice(0, 5).join('；') };
    return { kind: 'done', evidence: { kind: 'metadata', count: proofs.length,
      digest: jsonHash({ operationId: context.operationId, generation: context.generation, scope: scope.digest, proofs }),
      description: '全部原运行作业已按当前租约接续，数字清理与独立原执行停止证明已核对；工作卷留给后续统一回收' } };
  } };
}
