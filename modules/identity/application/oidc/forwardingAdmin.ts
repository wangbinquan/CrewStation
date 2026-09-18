import type { EffectiveForwardingDto, IdentityForwardingDto, ProjectId, UpdateIdentityForwardingRequest, UserId } from '@crewstation/contracts';
import { UpdateIdentityForwardingRequestSchema } from '@crewstation/contracts';
import { forbidden, validation } from '@crewstation/kernel';
import { effectiveForwardingFields, forwardingCandidates, forwardingProjection } from '../../domain/identityForwarding';
import type { IdentityUseCaseDeps } from '../dependencies';

type Deps = Pick<IdentityUseCaseDeps, 'uow' | 'clock' | 'projects'>;

/** 注入路径上的短缓存：转发集改动最长 5 秒生效，比身份令牌 300 秒的寿命短一个数量级。 */
const INJECTION_CACHE_MS = 5_000;

export interface ForwardingActor {
  readonly userId: UserId;
  readonly isAdmin: boolean;
}

/**
 * 身份转发（RFC-005 §6.4）：平台侧存全量档案，外发按集合裁剪。
 * 只有管理员能改——身份数据外发属于平台治理，与「定向 API 开放由管理员批」同一分工。
 */
export function forwardingUseCases(deps: Deps) {
  const injectionCache = new Map<string, { readonly at: number; readonly value: EffectiveForwardingDto }>();
  // 本副本自己的写入立刻清缓存；其他副本靠 TTL 收敛。装配时全模块共用一个实例，
  // 所以管理面改完之后，同进程的 ForwardAuth 下一次请求就看到新集合。
  const invalidate = (): void => injectionCache.clear();
  const requireAdmin = (actor: ForwardingActor): void => { if (!actor.isAdmin) throw forbidden('只有管理员可以修改身份转发'); };
  const candidates = async (): Promise<ReturnType<typeof forwardingCandidates>> =>
    forwardingCandidates((await deps.uow.read.providers.list()).map((p) => ({ slug: p.slug, claimMappings: p.claimMappings })));

  const parseFields = async (raw: unknown): Promise<UpdateIdentityForwardingRequest['fields']> => {
    const parsed = UpdateIdentityForwardingRequestSchema.safeParse(raw);
    if (!parsed.success) throw validation('转发字段不合法：只能是小写字母开头的字段名', { code: 'forwarding-field-invalid' });
    const known = new Set((await candidates()).map((c) => c.key));
    const unknown = parsed.data.fields.filter((key) => !known.has(key));
    if (unknown.length > 0) throw validation(`未知的转发字段：${unknown.join('、')}`, { code: 'forwarding-field-invalid', unknown });
    return parsed.data.fields;
  };

  const effectiveForwarding = async (projectId: ProjectId): Promise<EffectiveForwardingDto> => {
    const [global, project, candidateList] = await Promise.all([
      deps.uow.read.forwarding.readGlobal(),
      deps.uow.read.forwarding.readProject(projectId),
      candidates(),
    ]);
    const { fields, source } = effectiveForwardingFields({ global: global.fields, project: project?.fields }, candidateList);
    const projection = forwardingProjection(fields);
    return { projectId, source, fields, headers: projection.headers, tokenClaims: projection.tokenClaims };
  };

  return {
    readForwarding: async (actor: ForwardingActor): Promise<IdentityForwardingDto> => {
      requireAdmin(actor);
      const [global, projects, candidateList] = await Promise.all([deps.uow.read.forwarding.readGlobal(), deps.uow.read.forwarding.listProjects(), candidates()]);
      return {
        global: { fields: [...global.fields], updatedBy: global.updatedBy, updatedAt: global.updatedAt?.toISOString() ?? null },
        projects: projects.map((row) => ({
          projectId: row.projectId,
          fields: [...row.fields],
          updatedBy: row.updatedBy ?? ('' as UserId),
          updatedAt: (row.updatedAt ?? new Date(0)).toISOString(),
        })),
        candidates: candidateList,
      };
    },

    setGlobalForwarding: async (actor: ForwardingActor, raw: unknown): Promise<void> => {
      requireAdmin(actor);
      const fields = await parseFields(raw);
      await deps.uow.run((scope) => scope.forwarding.writeGlobal(fields, actor.userId, deps.clock.now()));
      invalidate();
    },

    setProjectForwarding: async (actor: ForwardingActor, projectId: ProjectId, raw: unknown): Promise<void> => {
      requireAdmin(actor);
      const fields = await parseFields(raw);
      await deps.uow.run((scope) => scope.forwarding.writeProject(projectId, fields, actor.userId, deps.clock.now()));
      invalidate();
    },

    clearProjectForwarding: async (actor: ForwardingActor, projectId: ProjectId): Promise<void> => {
      requireAdmin(actor);
      await deps.uow.run((scope) => scope.forwarding.clearProject(projectId));
      invalidate();
    },

    /**
     * 某项目实际生效的集合。ForwardAuth 的注入、生效预览与能力说明都读这一个函数，
     * 三处同源是「能力说明不说谎」的唯一保证（B10）。
     */
    effectiveForwarding,

    /** ForwardAuth 用：按主机里的项目 slug 求生效集，带 5 秒缓存以免每个业务请求都多查三次库。 */
    effectiveForwardingForSlug: async (projectSlug: string): Promise<EffectiveForwardingDto | undefined> => {
      const now = deps.clock.now().getTime();
      const cached = injectionCache.get(projectSlug);
      if (cached && now - cached.at < INJECTION_CACHE_MS) return cached.value;
      const projectId = await deps.projects.idBySlug(projectSlug);
      if (projectId === undefined) {
        const [global, candidateList] = await Promise.all([deps.uow.read.forwarding.readGlobal(), candidates()]);
        const { fields } = effectiveForwardingFields({ global: global.fields, project: undefined }, candidateList);
        const projection = forwardingProjection(fields);
        // 项目查不到时只按全局默认走，且不缓存——它多半意味着装配未完成或项目刚建好。
        return { projectId: '' as ProjectId, source: 'global', fields, headers: projection.headers, tokenClaims: projection.tokenClaims };
      }
      const value = await effectiveForwarding(projectId);
      injectionCache.set(projectSlug, { at: now, value });
      return value;
    },
  };
}
