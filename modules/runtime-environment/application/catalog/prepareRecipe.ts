import type { Actor, CreateRuntimeImageRevision } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { RuntimeImageDeps } from '../dependencies';

/** 来源权限与全局镜像生命周期分开；Secret 的业务边界不因平台归属而放宽。 */
export async function prepareRecipe(deps: RuntimeImageDeps, actor: Actor, legacyProjectId: string | undefined, input: CreateRuntimeImageRevision) {
  const sourceProjectId = input.sourceProjectId ?? legacyProjectId;
  if ((input.source.kind === 'source' || input.initializer.secrets.length > 0) && !sourceProjectId) throw precondition('源码或初始化凭据需要指定来源业务');
  if (sourceProjectId) await deps.authorizer.authorize(actor, sourceProjectId, 'develop');
  const prepared = await deps.sources.prepare(actor, sourceProjectId, input.source);
  if (prepared.source.kind === 'source' && (!prepared.commitSha || !/^[0-9a-f]{40,64}$/.test(prepared.commitSha))) throw precondition('源码未解析到固定提交');
  if (prepared.source.kind === 'existing' && !/@sha256:[0-9a-f]{64}$/.test(prepared.source.reference)) throw precondition('已有镜像未解析到固定摘要');
  return { ...prepared, ...(sourceProjectId ? { sourceProjectId } : {}), ...(input.initializer.secrets.length ? { initializerProjectId: sourceProjectId } : {}), initializer: input.initializer, tools: input.tools };
}
