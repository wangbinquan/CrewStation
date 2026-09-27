import type { TaskId } from '@crewstation/contracts';
import type { ExecutionLedger } from '../ports/executionLedger';

/** CLI 的界面事实由 dev-session 上报；组合根把它写回 task-runtime 所有的执行记录。 */
export function executionRecords(resources: ExecutionLedger) {
  const owner = resources.owner('task-runtime');
  return {
    phases: async (workspaceTaskId: TaskId) => new Map((await resources.list({ parentId: workspaceTaskId, kind: 'agent-execution', includeStopped: true })).map((record) => [record.id, record.phase])),
    reportInterface: async (id: TaskId, ready: boolean): Promise<void> => {
      const record = await resources.get(id);
      if (!record || record.kind !== 'agent-execution' || record.purpose !== 'development-cli' || record.owner.module !== 'task-runtime' || record.owner.ref !== id || record.desired !== 'present') return;
      // 首次就绪前不写 false：缺失表示等待；曾经为真后变为 false 才表示降级。
      const previous = record.conditions.find((entry) => entry.type === 'InterfaceReady');
      if (!ready && !previous) return;
      await owner.report(id, { conditions: [{ type: 'InterfaceReady', status: ready ? 'true' : 'false', reason: ready ? 'cli-interface-ready' : 'cli-interface-unavailable', message: ready ? 'CLI 界面已就绪' : 'CLI 界面暂不可用' }] });
    },
  };
}
