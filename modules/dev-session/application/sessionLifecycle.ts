import type { Actor, BranchDto, DevSessionDto, Manifest, OpenDevSessionRequest, PreviewState, ProjectId, RebuildDevSessionRequest, TaskId, WorkspaceStatusDto } from '@crewstation/contracts';
import { forbidden, conflict, isPlatformError, notFound, precondition } from '@crewstation/kernel';
import { inspectWorkspace } from './workspaceStatus';
import type { DevSessionUseCaseDeps } from './dependencies';
import type { EnvironmentView } from '../ports/runtime';

/** 读会话时顺带取预览状态的最长等待。 */
export const PREVIEW_PEEK_MS = 1_000;

/**
 * 读会话只顺带一个预览状态，最多等 PREVIEW_PEEK_MS：cs-session 或 Runner 卡住时，每次读都会等满命令超时（约 10 秒），
 * 开发页停在「正在读取会话」、网关偶尔回 502（2026-09-23 实机）。等不到按读不到处理；准确状态由预览接口给出。
 */
async function peekPreview(runner: DevSessionUseCaseDeps['runner'], env: EnvironmentView): Promise<PreviewState> {
  if (!env.connected) return 'stopped';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), PREVIEW_PEEK_MS); });
  try {
    const reply = await Promise.race([runner.sendCommand(env.id, { id: `p-${Date.now()}`, type: 'previewStatus' }), deadline]) as { state: PreviewState } | undefined;
    return reply?.state ?? 'stopped';
  } catch { return 'stopped'; } finally { clearTimeout(timer); }
}

/** 一项目一会话（D46）：开会话选分支，容器就绪后 TaskRunner 按 Manifest 自动起预览；释放即回收。 */
export function sessionLifecycleUseCases(deps: DevSessionUseCaseDeps) {
  const { environments, runner, scm, releases, authorizer, services, settings, clock } = deps;

  const toDto = async (env: EnvironmentView, slug: string, preview: PreviewState, reminderAt?: Date): Promise<DevSessionDto> => ({
    taskId: env.id, projectId: env.projectId, state: env.state === 'paused' ? 'running' : env.state, branch: env.branch ?? '', ...(env.podName ? { podName: env.podName } : {}),
    previewHost: `dev.${slug}.${settings.userDomain}`, preview, createdBy: (env as { createdBy?: DevSessionDto['createdBy'] }).createdBy ?? ('usr_00000000000000000000000000000000' as DevSessionDto['createdBy']),
    createdAt: env.createdAt, lastActivityAt: env.lastActivityAt, ...(reminderAt ? { idleReminderSentAt: reminderAt.toISOString() } : {}), ...(env.message ? { message: env.message } : {}),
    rebuild: await environments.getRebuild(env.id),
    ...(env.connectionIssue ? { connectionIssue: env.connectionIssue } : {}),
    // RFC-022：开始开发或重建的五段，全部由 task-runtime 产出；observedAt 供页面校正本机时钟。
    ...(env.startup ? { startup: { ...env.startup, observedAt: clock.now().toISOString() } } : {}),
  });

  const previewOf = (env: EnvironmentView): Promise<PreviewState> => peekPreview(runner, env);

  /** 解析 Manifest；失败不抛，把原因带出去由调用方决定要不要当成失败。 */
  const readManifest = (text: string | undefined): { manifest?: Manifest; problem?: string } => {
    if (!text) return {};
    try {
      return { manifest: deps.manifests.parse(text) };
    } catch (error) {
      const problem = isPlatformError(error) ? error.message : String(error);
      deps.logger.warn('dev session opened with an invalid manifest', { problem });
      return { problem };
    }
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
      // Manifest 坏了照样把会话开起来，只是没有预览：开发容器正是改这个文件的地方，
      // 在这里硬失败会把唯一的修复路径也一起关掉（RFC-001 让所有老仓库的 Manifest 一次性失效，实撞）。
      const loaded = readManifest(manifestText);
      const manifest = loaded.manifest;
      const dev = manifest?.spec.development;
      const preview = dev
        ? { command: dev.command, port: dev.port ?? manifest?.spec.service.port ?? settings.defaultPreviewPort, healthPath: dev.healthPath ?? manifest?.spec.service.healthPath ?? '/' }
        : manifest ? { command: manifest.spec.service.command, port: manifest.spec.service.port, healthPath: manifest.spec.service.healthPath } : undefined;
      const env = await environments.createEnvironment({ serviceId: svc.serviceId, kind: 'dev-session', branch: input.branch, createdBy: actor.userId, ...(preview ? { preview } : {}), labels: { 'crewstation.io/project': svc.slug, 'crewstation.io/service': svc.name } });
      const dto = await toDto(env, svc.slug, 'starting');
      return loaded.problem === undefined ? dto : { ...dto, message: `${loaded.problem}；会话已开启但没有预览，改好 crewstation.yaml 后释放会话再开一次即可` };
    },
    getSession: async (actor: Actor, projectId: ProjectId): Promise<DevSessionDto | undefined> => {
      await authorizer.authorize(actor, projectId, 'view');
      const env = await environments.findDevSession(projectId, { includeLatestFailure: true });
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
    releaseSession: async (actor: Actor, projectId: ProjectId, options: { force?: boolean; expectedTaskId?: TaskId } = {}): Promise<{ session: DevSessionDto; unpushed: string[] | null; workspace: WorkspaceStatusDto }> => {
      const env = await environments.findDevSession(projectId);
      if (!env) throw notFound('开发会话', projectId);
      const mine = (env as { createdBy?: string }).createdBy === actor.userId;
      await authorizer.authorize(actor, projectId, mine ? 'develop' : 'force-release-session');
      if (options.expectedTaskId && options.expectedTaskId !== env.id) throw precondition('开发会话已变化，请重新确认释放对象');
      if (!mine && !options.force) throw precondition('释放他人的会话需要 force=true');
      const workspace = await inspectWorkspace(deps, env);
      const unpushed = workspace.status === 'ready' && workspace.unpushed.status === 'ready'
        ? workspace.unpushed.commits.map((commit) => `${commit.sha} ${commit.subject}`) : null;
      const released = await environments.releaseEnvironment(env.id, mine ? 'user' : 'owner-force');
      const svc = await svcOf(projectId);
      deps.logger.info('dev session released', { taskId: env.id, by: actor.userId, forced: !mine, unpushed: unpushed?.length ?? 'unknown', at: clock.now().toISOString() });
      return { session: await toDto(released, svc.slug, 'stopped'), unpushed, workspace };
    },
    touch: (taskId: TaskId) => environments.touch(taskId),
  };
}

/** 与新建一样使用 develop 权限；固定任务、卷和套餐的校验由运行时原子执行。 */
export function rebuildSessionUseCases({ authorizer, environments }: DevSessionUseCaseDeps) {
  return {
    inspectSessionRebuild: async (actor: Actor, projectId: ProjectId) => {
      await authorizer.authorize(actor, projectId, 'develop');
      return environments.inspectRebuild(projectId);
    },
    rebuildSession: async (actor: Actor, projectId: ProjectId, input: RebuildDevSessionRequest) => {
      if (input.reason === 'administrator-restart' && !actor.isAdmin) throw forbidden('只有管理员可以主动重启正常开发会话');
      await authorizer.authorize(actor, projectId, 'develop');
      return environments.requestRebuild(projectId, input);
    },
  };
}
