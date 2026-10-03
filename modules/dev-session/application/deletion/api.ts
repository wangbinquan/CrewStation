import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { DevSessionModuleApi } from '../../api/moduleApi';
import type { DevelopmentProjectWork } from '../../ports/deletion/work';

const origins = {
  inspectSessionRebuild: 'project', rebuildSession: 'project', invokeApi: 'project', previewStatus: 'project', controlPreview: 'project', previewLogs: 'project',
  openSession: 'project', getSession: 'project', listBranches: 'project', workspaceStatus: 'project', versionComparison: 'project', versionComparisonDetails: 'project',
  refreshComparisonHistory: 'project', releaseSession: 'project', publish: 'project', inspectClusterNative: 'task', inspectClusterAgent: 'task',
  manageClusterNative: 'task', manageClusterAgent: 'task', getAgentActivity: 'task', readAgentActivity: 'task', getWorkspaceLayout: 'task', saveWorkspaceLayout: 'task',
  startAgent: 'task', sendMessage: 'task', cancelAgent: 'task', listAgents: 'task', startNativeTerminal: 'task', listNativeTerminals: 'task',
  stopNativeTerminal: 'task', getNativeTerminalSnapshot: 'task', touch: 'task-key',
  dispatchPendingNativeExecution: 'background', reconcileNativeExecutions: 'background', sendIdleReminders: 'background',
} satisfies Record<Exclude<keyof DevSessionModuleApi, 'name' | 'deletionOwner' | 'developmentUsage' | 'developmentCleanup'>, 'project' | 'task' | 'task-key' | 'background'>;

/** One original callback for every project-facing response, with separate retained lifetimes for bounded child I/O. */
export function developmentWorkApi(api: DevSessionModuleApi, work: DevelopmentProjectWork): DevSessionModuleApi {
  const guarded = { ...api };
  for (const [name, kind] of Object.entries(origins)) {
    if (kind === 'background') continue;
    Object.defineProperty(guarded, name, { enumerable: true,
    value: (...args: unknown[]) => {
      const project = kind === 'project', originKey = args[kind === 'task-key' ? 0 : 1];
      if (typeof originKey !== 'string') return Promise.reject(precondition('开发请求缺少原项目或任务身份'));
      return work.runOriginResponse({ originKind: project ? 'project' : 'task', originKey, kind: project ? 'project-api' : 'task-api',
        reference: newResourceId(), inputDigest: jsonHash({ method: name, args }) }, () => Reflect.apply(Reflect.get(api, name) as (...input: unknown[]) => Promise<unknown>, api, args));
    },
  });
  }
  return guarded;
}
