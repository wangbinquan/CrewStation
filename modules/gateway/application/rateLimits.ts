import type { Actor, ProjectId, ProjectRateLimitOverride, ProjectRateLimitsDto, RateLimits, RateLimitSettingsDto, SetProjectRateLimitsRequest, SetRateLimitSettingsRequest } from '@crewstation/contracts';
import { ProjectRateLimitOverrideSchema, RateLimitsSchema } from '@crewstation/contracts';
import { conflict, forbidden, notFound } from '@crewstation/kernel';
import { DEFAULT_RATE_LIMITS, effectiveProjectLimits, PLATFORM_RATE_LIMIT_SCOPE } from '../domain/rateLimits';
import type { RateLimitRow } from '../ports/repositories';
import type { GatewayUseCaseDeps } from './dependencies';

const STALE = '限流设置已被他人修改，请刷新后重新确认';

const meta = (row: RateLimitRow | undefined) => ({ revision: row?.revision ?? 0, updatedAt: row?.updatedAt.toISOString() ?? null, ...(row ? { updatedBy: row.updatedBy } : {}) });

/**
 * 网关限流策略（RFC-025 设计 §7.3）：平台默认与项目覆盖，只给管理员读写，按版本号乐观并发。库里读出来的按契约再校验一遍，
 * 不合格的（手改过库）按没有处理：平台默认退回内置值，项目覆盖视为没有。
 */
export function rateLimitUseCases(deps: GatewayUseCaseDeps) {
  const requireAdmin = (actor: Actor) => { if (!actor.isAdmin) throw forbidden('只有管理员可以查看或修改限流设置'); };
  const platform = async (): Promise<{ readonly limits: RateLimits; readonly row: RateLimitRow | undefined }> => {
    const row = await deps.rateLimits.get(PLATFORM_RATE_LIMIT_SCOPE);
    const parsed = row ? RateLimitsSchema.safeParse(row.body) : undefined;
    return { limits: parsed?.success ? parsed.data : DEFAULT_RATE_LIMITS, row };
  };
  const override = async (projectId: ProjectId): Promise<{ readonly value: ProjectRateLimitOverride | undefined; readonly row: RateLimitRow | undefined }> => {
    const row = await deps.rateLimits.get(projectId);
    const parsed = row ? ProjectRateLimitOverrideSchema.safeParse(row.body) : undefined;
    return { value: parsed?.success ? parsed.data : undefined, row };
  };
  // 在册服务里没有它（不存在或已归档）：不能读写它的覆盖。
  const requireProject = async (projectId: ProjectId) => { if (!(await deps.services.listServices()).some((service) => service.projectId === projectId)) throw notFound('项目', projectId); };
  const project = async (projectId: ProjectId): Promise<ProjectRateLimitsDto> => {
    await requireProject(projectId);
    const [defaults, own] = await Promise.all([platform(), override(projectId)]);
    return { projectId, override: own.value ?? null, effective: effectiveProjectLimits(defaults.limits, own.value), ...meta(own.row) };
  };
  return {
    getRateLimits: async (actor: Actor): Promise<RateLimitSettingsDto> => {
      requireAdmin(actor);
      const { limits, row } = await platform();
      return { ...limits, ...meta(row) };
    },
    setRateLimits: async (actor: Actor, input: SetRateLimitSettingsRequest): Promise<RateLimitSettingsDto> => {
      requireAdmin(actor);
      const { expectedRevision, ...limits } = input;
      const saved = await deps.rateLimits.save(PLATFORM_RATE_LIMIT_SCOPE, limits, expectedRevision, deps.clock.now(), actor.userId);
      if (!saved) throw conflict(STALE);
      deps.logger.info('rate limits updated', { scope: PLATFORM_RATE_LIMIT_SCOPE, revision: saved.revision });
      return { ...limits, ...meta(saved) };
    },
    getProjectRateLimits: async (actor: Actor, projectId: ProjectId): Promise<ProjectRateLimitsDto> => { requireAdmin(actor); return project(projectId); },
    setProjectRateLimits: async (actor: Actor, projectId: ProjectId, input: SetProjectRateLimitsRequest): Promise<ProjectRateLimitsDto> => {
      requireAdmin(actor);
      await requireProject(projectId);
      // 撤掉：版本号 0 表示以为本来就没有——库里若已有覆盖（别人刚设过）照样是冲突。
      const written = input.override === null
        ? (input.expectedRevision === 0 ? !(await deps.rateLimits.get(projectId)) : await deps.rateLimits.remove(projectId, input.expectedRevision))
        : Boolean(await deps.rateLimits.save(projectId, input.override, input.expectedRevision, deps.clock.now(), actor.userId));
      if (!written) throw conflict(STALE);
      deps.logger.info('rate limits updated', { scope: projectId, override: input.override !== null });
      return project(projectId);
    },
    /** 项目生效的用户域与服务域（渲染网关中间件用）。 */
    effectiveRateLimits: async (projectId: ProjectId) => effectiveProjectLimits((await platform()).limits, (await override(projectId)).value),
  };
}
