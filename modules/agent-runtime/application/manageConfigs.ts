import type { Actor, CreateRuntimeConfigRequest, RuntimeConfigDetailDto, RuntimeConfigDto, RuntimeConfigId, RuntimeConfigListQuery, RuntimeConfigPage } from '@crewstation/contracts';
import { RuntimeConfigPageSchema } from '@crewstation/contracts';
import { conflict, newId, notFound, validation } from '@crewstation/kernel';
import { presetContent } from '../domain/presets';
import { validateRevisionContent } from '../domain/revisionValidation';
import type { RuntimeConfig, RuntimeRevision } from '../domain/runtimeConfig';
import { contentHashOf } from '../domain/runtimeConfig';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { adminOnly, checkToDto, configToDto, credentialStates, revisionToDto } from './toDto';

const cursorOf = (name: string) => Buffer.from(JSON.stringify({ after: name })).toString('base64url');
const afterOf = (cursor: string | undefined): string | undefined => {
  if (!cursor) return undefined;
  try { const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { after?: unknown }; if (typeof parsed.after === 'string') return parsed.after; } catch { /* fall through */ }
  throw validation('运行环境分页已失效，请从第一页重新查询');
};

/** 建档、列表与详情。详情不返回任何密钥原值或密文。 */
export function manageConfigUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, references, clock } = deps;
  const load = async (id: RuntimeConfigId): Promise<RuntimeConfig> => {
    const config = await uow.read.configs.getById(id);
    if (!config) throw notFound('运行环境', id);
    return config;
  };
  const summarize = async (config: RuntimeConfig): Promise<RuntimeConfigDto> => {
    const draft = await uow.read.revisions.get(config.id, config.draftRevision);
    const latest = draft ? await uow.read.checks.latestFor(config.id, draft.revision, draft.contentHash) : undefined;
    return configToDto(config, (await references.listReferencing(config.id)).length, latest);
  };
  return {
    createConfig: async (actor: Actor, input: CreateRuntimeConfigRequest): Promise<RuntimeConfigDetailDto> => {
      adminOnly(actor);
      const content = presetContent(input.preset, input.driver);
      validateRevisionContent(content);
      const now = clock.now();
      const config: RuntimeConfig = { id: newId('arc') as RuntimeConfigId, name: input.name, description: input.description, driver: input.driver, draftRevision: 1, activeRevision: null, enabled: true, createdBy: actor.userId, createdAt: now, updatedBy: actor.userId, updatedAt: now };
      const revision: RuntimeRevision = { ...content, configId: config.id, revision: 1, contentHash: contentHashOf(content), createdBy: actor.userId, createdAt: now };
      await uow.run(async (scope) => {
        if (await scope.configs.getByName(input.name)) throw conflict(`运行环境 ${input.name} 已存在`, { name: input.name });
        await scope.configs.insert(config);
        await scope.revisions.insert(revision);
      });
      return { ...configToDto(config, 0, undefined), draft: revisionToDto(revision), credentials: credentialStates(revision.secretNames, []), referencedBy: [] };
    },
    listConfigs: async (actor: Actor, query: RuntimeConfigListQuery): Promise<RuntimeConfigPage> => {
      adminOnly(actor);
      const enabled = query.status === 'disabled' ? false : query.status === undefined ? undefined : true;
      const rows = await uow.read.configs.listPage({ ...(query.name ? { name: query.name } : {}), ...(query.driver ? { driver: query.driver } : {}), ...(enabled === undefined ? {} : { enabled }) }, query.limit + 1, afterOf(query.cursor));
      const page = rows.slice(0, query.limit);
      let items = await Promise.all(page.map(summarize));
      if (query.status && query.status !== 'disabled') items = items.filter((item) => item.status === query.status);
      const last = page.at(-1);
      return RuntimeConfigPageSchema.parse({ items, ...(rows.length > query.limit && last ? { nextCursor: cursorOf(last.name) } : {}) });
    },
    getConfig: async (actor: Actor, id: RuntimeConfigId): Promise<RuntimeConfigDetailDto> => {
      adminOnly(actor);
      const config = await load(id);
      const [draft, active, stored, referencedBy] = await Promise.all([
        uow.read.revisions.get(id, config.draftRevision), config.activeRevision === null ? undefined : uow.read.revisions.get(id, config.activeRevision),
        uow.read.credentials.list(id), references.listReferencing(id),
      ]);
      if (!draft) throw notFound('运行环境草稿', `${id}@${config.draftRevision}`);
      const latest = await uow.read.checks.latestFor(id, draft.revision, draft.contentHash);
      return {
        ...configToDto(config, referencedBy.length, latest), draft: revisionToDto(draft), ...(active ? { active: revisionToDto(active) } : {}),
        credentials: credentialStates([...new Set([...draft.secretNames, ...(active?.secretNames ?? [])])], stored), referencedBy, ...(latest ? { latestCheckId: latest.checkId, latestCheck: checkToDto(latest) } : {}),
      };
    },
    /** project 的绑定校验与租户就绪投影用；无 actor，不含内容。 */
    describeConfig: async (id: string) => {
      const config = await uow.read.configs.getById(id as RuntimeConfigId);
      return config ? { id: config.id, name: config.name, driver: config.driver, enabled: config.enabled, activeRevision: config.activeRevision } : undefined;
    },
  };
}
