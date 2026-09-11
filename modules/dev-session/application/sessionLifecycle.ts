import type { Actor, BranchDto, DevSessionDto, OpenDevSessionRequest, PreviewState, ProjectId, TaskId } from '@crewstation/contracts';
import { conflict, notFound, precondition } from '@crewstation/kernel';
import { unpushedCommits } from '../domain/gitStatus';
import type { DevSessionUseCaseDeps } from './dependencies';
import type { EnvironmentView } from '../ports/runtime';

/** 一项目一会话（D46）：开会话选分支，容器就绪后 TaskRunner 按 Manifest 自动起预览；释放即回收。 */
export function sessionLifecycleUseCases(deps: DevSessionUseCaseDeps) {
  const { environments, runner, scm, releases, authorizer, services, settings, clock } = deps;

  const toDto = async (env: EnvironmentView, slug: string, preview: PreviewState, reminderAt?: Date): Promise<DevSessionDto> => ({
    taskId: env.id, projectId: env.projectId, state: env.state === 'paused' ? 'running' : env.state, branch: env.branch ?? '', ...(env.podName ? { podName: env.podName } : {}),
    previewHost: `dev.${slug}.${settings.userDomain}`, preview, createdBy: (env as { createdBy?: DevSessionDto['createdBy'] }).createdBy ?? ('usr_00000000000000000000000000000000' as DevSessionDto['createdBy']),
    createdAt: env.createdAt, lastActivityAt: env.lastActivityAt, ...(reminderAt ? { idleReminderSentAt: reminderAt.toISOString() } : {}), ...(env.message ? { message: env.message } : {}),
  });

  const previewOf = async (env: EnvironmentView): Promise<PreviewState> => {
    if (!env.connected) return 'stopped';
    try { return ((await runner.sendCommand(env.id, { id: `p-${Date.now()}`, type: 'previewStatus' })) as { state: PreviewState }).state; } catch { return 'stopped'; }
  };

  const svcOf = async (projectId: ProjectId) => {
    const svc = await services.resolveServiceOfProject(projectId);
    if (!svc) throw notFound('项目服务', projectId);
    return svc;
  };

  return {
    openSession: async (actor: Actor, projectId: ProjectId, input: OpenDevSessionRequest): Promise<DevSessionDto> => {
      await authorizer.authorize(actor, projectId, 'develop');
      const svc = await svcOf(projectId);
      if (await environments.findDevSession(projectId)) throw conflict('该项目已有一个开发会话，请先释放');
      const manifestText = await scm.readFile(svc.serviceId, input.branch, 'crewstation.yaml');
      const manifest = manifestText ? deps.manifests.parse(manifestText) : undefined;
      const dev = manifest?.spec.development;
      const preview = dev
        ? { command: dev.command, port: dev.port ?? manifest?.spec.service.port ?? settings.defaultPreviewPort, healthPath: dev.healthPath ?? manifest?.spec.service.healthPath ?? '/' }
        : manifest ? { command: manifest.spec.service.command, port: manifest.spec.service.port, healthPath: manifest.spec.service.healthPath } : undefined;
      const env = await environments.createEnvironment({ serviceId: svc.serviceId, kind: 'dev-session', branch: input.branch, createdBy: actor.userId, ...(preview ? { preview } : {}), labels: { 'crewstation.io/project': svc.slug, 'crewstation.io/service': svc.name } });
      return toDto(env, svc.slug, 'starting');
    },
    getSession: async (actor: Actor, projectId: ProjectId): Promise<DevSessionDto | undefined> => {
      await authorizer.authorize(actor, projectId, 'view');
      const env = await environments.findDevSession(projectId);
      if (!env) return undefined;
      const svc = await svcOf(projectId);
      return toDto(env, svc.slug, await previewOf(env), await deps.reminders.lastReminder(env.id));
    },
    listBranches: async (actor: Actor, projectId: ProjectId): Promise<BranchDto[]> => {
      await authorizer.authorize(actor, projectId, 'view');
      const svc = await svcOf(projectId);
      const slots = await releases.getSlots(actor, svc.serviceId);
      const previewSha = slots.find((s) => s.name === 'preview')?.commitSha;
      const prodSha = slots.find((s) => s.name === 'prod')?.commitSha;
      return scm.listBranches(svc.serviceId, { ...(previewSha ? { previewSha } : {}), ...(prodSha ? { prodSha } : {}) });
    },
    /** 释放前列出未推送提交（AT-33）；负责人可强制释放他人会话（G19）。 */
    releaseSession: async (actor: Actor, projectId: ProjectId, options: { force?: boolean } = {}): Promise<{ session: DevSessionDto; unpushed: string[] }> => {
      const env = await environments.findDevSession(projectId);
      if (!env) throw notFound('开发会话', projectId);
      const mine = (env as { createdBy?: string }).createdBy === actor.userId;
      await authorizer.authorize(actor, projectId, mine ? 'develop' : 'force-release-session');
      if (!mine && !options.force) throw precondition('释放他人的会话需要 force=true');
      let unpushed: string[] = [];
      if (env.connected) {
        try {
          const out = (await runner.sendCommand(env.id, { id: `u-${Date.now()}`, type: 'exec', execId: `u-${Date.now()}`, command: ['git', 'log', '--branches', '--not', '--remotes', '--oneline'], timeoutSeconds: 60, env: {}, wait: true })) as { stdout?: string } | null;
          unpushed = unpushedCommits(out?.stdout ?? '');
        } catch { unpushed = []; }
      }
      const released = await environments.releaseEnvironment(env.id, mine ? 'user' : 'owner-force');
      const svc = await svcOf(projectId);
      deps.logger.info('dev session released', { taskId: env.id, by: actor.userId, forced: !mine, unpushed: unpushed.length, at: clock.now().toISOString() });
      return { session: await toDto(released, svc.slug, 'stopped'), unpushed };
    },
    touch: (taskId: TaskId) => environments.touch(taskId),
  };
}
