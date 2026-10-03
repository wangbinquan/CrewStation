import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { TaskRuntimeModuleApi } from '../../api/moduleApi';
import type { RuntimeProjectWork } from '../../ports/deletion/work';
import type { RuntimeWorkInput } from '../../domain/deletion/work';
import { guardedRuntimePort } from './ports';

type Rule = 'readonly' | 'platform' | 'background' | 'nested' | 'task-0' | 'task-1' | 'project-0' | 'project-1' | 'project-input' | 'service-input' | 'service-0' | 'task-input' | 'parent-input' | 'ending' | 'probe-stop';
const origins = {
  originalInfrastructureOwnership: 'readonly', originalProjectTaskIds: 'readonly', inspectDevelopmentRemoval: 'readonly', listClusterTasks: 'readonly',
  reconcile: 'background', observeStartup: 'background', runProfileTest: 'platform', archiveExecution: 'nested', storageCleanup: 'nested',
  resourceWorkload: 'readonly', resourceWorkloads: 'readonly', inspectResourceEnding: 'ending',
  freezeBusinessStorage: 'task-input', resolveBusinessStorage: 'task-input', stopBusinessStorage: 'task-input', rebuildBusinessWorkspace: 'task-input',
  restartBusinessWorkspace: 'task-input', inspectBusinessRecovery: 'readonly', imageHistory: 'readonly', blockBusinessAdmission: 'service-0',
  imageReferenceState: 'readonly', runRuntimeImageProbe: 'project-input', stopRuntimeImageProbe: 'probe-stop', reconcileRebuild: 'task-0',
  lookupDevelopmentUsageLayout: 'readonly', inspectDevelopmentCleanupSelection: 'readonly', resolveDevelopmentObjectSource: 'task-input',
  createEnvironment: 'service-input', createNativeExecution: 'parent-input', releaseEnvironment: 'task-0', pauseEnvironment: 'task-0', resumeEnvironment: 'task-0',
  markFailed: 'task-0', touch: 'task-0', onRunnerConnected: 'task-0', onRunnerDisconnected: 'task-0', onRunnerRejected: 'task-0',
  inspectRebuild: 'project-0', requestRebuild: 'project-0', getRebuild: 'readonly', getEnvironment: 'readonly', describeEnvironment: 'readonly',
  listEnvironments: 'readonly', findDevSession: 'readonly', listRunningDevSessions: 'readonly', runningTaskCount: 'readonly', traceKeys: 'readonly',
  activeTraceIds: 'readonly', listTraceEnvironments: 'readonly', verifyRunnerToken: 'task-0', canOpenStream: 'task-1', captureStartupLog: 'readonly',
  runnerValues: 'task-0', checkoutValues: 'task-0', bindWorkload: 'task-0', workloadUnavailable: 'task-0',
} satisfies Record<Exclude<keyof TaskRuntimeModuleApi, 'name'>, Rule>;
const field = (value: unknown, key: string) => value && typeof value === 'object' ? Reflect.get(value, key) as unknown : undefined;
function selection(rule: Rule, args: unknown[]): Pick<RuntimeWorkInput, 'originKind' | 'originKey'> {
  let originKind: RuntimeWorkInput['originKind'] = 'task', key: unknown;
  if (rule === 'project-0' || rule === 'project-1') { originKind = 'project'; key = args[rule === 'project-0' ? 0 : 1]; }
  else if (rule === 'project-input') { originKind = 'project'; key = field(args[0], 'projectId'); }
  else if (rule === 'service-input' || rule === 'service-0') { originKind = 'service'; key = rule === 'service-0' ? args[0] : field(args[0], 'serviceId'); }
  else if (rule === 'task-input' || rule === 'parent-input') key = field(args[0], rule === 'parent-input' ? 'parentTaskId' : 'taskId');
  else if (rule === 'ending') key = String(field(field(args[1], 'owner'), 'ref') ?? '').split('/')[0];
  else key = args[rule === 'task-1' ? 1 : 0];
  if (typeof key !== 'string' || !key) throw precondition('运行请求缺少原项目、服务或任务身份');
  return { originKind, originKey: key };
}
/** Exhaustive project API classification; maintenance source readers remain available to deletion owners. */
export function runtimeWorkApi(api: TaskRuntimeModuleApi, work: RuntimeProjectWork): TaskRuntimeModuleApi {
  const guarded = { ...api };
  for (const [name, rule] of Object.entries(origins)) {
    if (['readonly', 'platform', 'background', 'nested'].includes(rule) || typeof Reflect.get(api, name) !== 'function') continue;
    Object.defineProperty(guarded, name, { enumerable: true, value: async (...args: unknown[]) => {
      // An early cancellation with no environment only creates the platform's non-running cancellation tombstone.
      if (rule === 'probe-stop' && !await api.getEnvironment(args[0] as Parameters<typeof api.getEnvironment>[0]))
        return Reflect.apply(api.stopRuntimeImageProbe, api, args);
      const input = selection(rule, args), callArgs = [...args];
      if (name === 'reconcileRebuild' && callArgs[2] && typeof callArgs[2] === 'object') callArgs[2] = guardedRuntimePort(callArgs[2], work);
      return work.runOriginResponse({ ...input, kind: input.originKind === 'project' ? 'project-api' : input.originKind === 'service' ? 'service-api' : 'task-api',
        reference: newResourceId(), inputDigest: jsonHash({ method: name, args }) }, () => Reflect.apply(Reflect.get(api, name) as (...input: unknown[]) => Promise<unknown>, api, callArgs));
    } });
  }
  return guarded;
}
