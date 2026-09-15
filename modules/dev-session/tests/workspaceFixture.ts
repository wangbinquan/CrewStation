import type { Actor, ProjectId, ReleaseId, RunnerCommand, ServiceId, TaskId, UserId } from '@crewstation/contracts';
import { fixedClock, noopLogger } from '@crewstation/kernel';
import type { DevSessionUseCaseDeps } from '../application/dependencies';
import type { EnvironmentView } from '../ports/runtime';

export const workspaceProject = 'prj_0123456789abcdef0123456789abcdef' as ProjectId;
export const workspaceService = 'svc_0123456789abcdef0123456789abcdef' as ServiceId;
export const workspaceActor: Actor = { userId: 'usr_0123456789abcdef0123456789abcdef' as UserId, isAdmin: false };
export const workspaceTask = 'tsk_0123456789abcdef0123456789abcdef' as TaskId;
export const workspaceSha = '0123456789abcdef0123456789abcdef01234567';
export const checkedAt = '2026-09-13T00:00:00.000Z';

export function readyWorkspace() {
  return {
    status: 'ready' as const, headSha: workspaceSha, branch: 'main', shallow: false, fingerprint: 'fp-1',
    uncommitted: [], uncommittedCount: 0, uncommittedTruncated: false,
    unpushed: { status: 'ready' as const, count: 0, commits: [], truncated: false },
    upstream: { status: 'missing' as const }, checkedAt,
  };
}

export function workspaceFixture() {
  const commands: RunnerCommand[] = [];
  const state = { connected: true, missing: false, released: false, published: false, result: readyWorkspace() as unknown, execCode: 0 };
  const environment = (): EnvironmentView & { createdBy: UserId } => ({
    id: workspaceTask, projectId: workspaceProject, serviceId: workspaceService, connected: state.connected,
    state: 'running', branch: 'main', podName: 'task-test', createdAt: checkedAt, lastActivityAt: checkedAt, traceId: 'trace', createdBy: workspaceActor.userId,
  });
  const deps: DevSessionUseCaseDeps = {
    apiCatalog: { listOperations: async () => [] },
    environments: {
      getRebuild: async () => undefined,
      inspectRebuild: async () => { throw new Error("恢复预检未设置"); },
      requestRebuild: async () => { throw new Error("恢复请求未设置"); },
      createEnvironment: async () => environment(), getEnvironment: async () => environment(),
      findDevSession: async () => state.missing ? undefined : environment(), listRunningDevSessions: async () => [environment()],
      releaseEnvironment: async () => { state.released = true; return { ...environment(), state: 'released' }; },
      touch: async () => {}, canOpenStream: async () => true,
    },
    runner: {
      sendCommand: async (_task, command) => {
        commands.push(command);
        if (command.type === 'exec') return { execId: command.execId, exitCode: state.execCode, stdout: '', stderr: 'fatal: not a git repository', durationMs: 1, truncated: false };
        return state.result;
      }, listEvents: async () => [],
    },
    authorizer: { authorize: async () => {}, ownerOf: async () => workspaceActor.userId },
    services: { resolveServiceOfProject: async () => ({ serviceId: workspaceService, slug: 'demo', name: 'demo' }) },
    releases: {
      getSlots: async () => [], publish: async (_actor, _service, input) => {
        state.published = true;
        return { id: 'rel_0123456789abcdef0123456789abcdef' as ReleaseId, serviceId: workspaceService, branch: input.branch, commitSha: workspaceSha, tag: 'v0.1.1', status: 'pending', createdBy: workspaceActor.userId, createdAt: checkedAt, updatedAt: checkedAt };
      },
    },
    scm: { readFile: async () => undefined, listBranches: async () => [], pushUrl: async () => ({ url: 'https://git.example/demo.git', expiresAt: checkedAt }) },
    compute: { resolve: async () => undefined, list: async () => [] }, manifests: { parse: () => { throw new Error('unused'); } },
    credentials: { issueDevSessionToken: async () => ({ token: 'test', expiresAt: checkedAt }) }, notifier: { notify: async () => {} },
    reminders: { lastReminder: async () => undefined, recordReminder: async () => {} },
    settings: { idleMinutes: 30, userDomain: 'cs.localhost', mcp: [], defaultPreviewPort: 3000, defaultComputeProfile: 'balanced' },
    clock: fixedClock(checkedAt), logger: noopLogger,
  };
  return { deps, state, commands };
}
