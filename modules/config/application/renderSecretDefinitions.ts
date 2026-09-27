import type { Actor, ConfigEnv, ProjectId } from '@crewstation/contracts';
import { ConfigEnvSchema, ResourceIdSchema, RuntimeImageSecretVersionSchema } from '@crewstation/contracts';
import { notFound, validation } from '@crewstation/kernel';
import { writeActionFor } from '../domain/configItem';
import type { ConfigUseCaseDeps } from './dependencies';

/** 构建与初始化的显式 Secret 挂载：先授权，再仅解密所选项；不向 HTTP 暴露。 */
export function renderSecretDefinitionsUseCase(deps: ConfigUseCaseDeps) {
  const { cipher } = deps;
  return async (actor: Actor, projectId: ProjectId, env: ConfigEnv, ids: readonly string[]): Promise<Record<string, string>> => {
    const selected = await selectedSecrets(deps, actor, projectId, env, ids);
    const values: Record<string, string> = {};
    for (const item of selected) values[item.definitionId] = await cipher.decrypt(item.value);
    return values;
  };
}

/** 只返回不可复用的项身份和版本戳；凭据轮换或删除重建都会使旧用途验证失效。 */
export function secretDefinitionVersionsUseCase(deps: ConfigUseCaseDeps) {
  return async (actor: Actor, projectId: ProjectId, env: ConfigEnv, ids: readonly string[]) => {
    const selected = await selectedSecrets(deps, actor, projectId, env, ids);
    return selected.map((item) => ({ definitionId: item.definitionId, itemId: item.id, version: item.version })).sort((a, b) => a.definitionId.localeCompare(b.definitionId));
  };
}

async function selectedSecrets({ uow, authorizer }: ConfigUseCaseDeps, actor: Actor, projectId: ProjectId, env: ConfigEnv, ids: readonly string[]) {
  ConfigEnvSchema.parse(env);
  if (ids.length > 32 || new Set(ids).size !== ids.length) throw validation('Secret 引用过多或重复');
  for (const id of ids) ResourceIdSchema.parse(id);
  await authorizer.authorize(actor, projectId, writeActionFor(env));
  const items = await uow.read.items.list(projectId, env);
  const selected = ids.map((id) => {
    const item = items.find((item) => item.definitionId === id);
    if (!item?.isSecret) throw notFound('Secret 配置', id);
    return item;
  });
  return selected;
}

/** 内部已授权快照回放：仅解密引用的历史 Secret，不从当前配置猜测版本。 */
export function renderPinnedSecretDefinitionsUseCase({ uow, cipher }: ConfigUseCaseDeps) {
  return async (projectId: ProjectId, env: ConfigEnv, stamps: readonly { definitionId: string; itemId: string; version: number }[]): Promise<Record<string, string>> => {
    ConfigEnvSchema.parse(env);
    if (stamps.length > 32 || new Set(stamps.map((s) => s.definitionId)).size !== stamps.length) throw validation('Secret 引用过多或重复');
    const values: Record<string, string> = {};
    for (const stamp of stamps) {
      RuntimeImageSecretVersionSchema.parse({ ...stamp, environment: env });
      const snapshot = await uow.read.versions.get(projectId, env, stamp.version);
      const entry = snapshot?.entries.find((item) => item.definitionId === stamp.definitionId && item.itemId === stamp.itemId && item.isSecret);
      if (!entry) throw notFound('Secret 配置快照', stamp.definitionId);
      values[stamp.definitionId] = await cipher.decrypt(entry.value);
    }
    return values;
  };
}
