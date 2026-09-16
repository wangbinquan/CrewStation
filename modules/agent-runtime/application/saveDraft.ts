import type { Actor, RuntimeConfigDetailDto, RuntimeConfigId, SaveRuntimeDraftRequest } from '@crewstation/contracts';
import { conflict, notFound } from '@crewstation/kernel';
import { planCredentialWrites } from '../domain/credentialWrites';
import { validateRevisionContent } from '../domain/revisionValidation';
import type { RuntimeRevision, RuntimeRevisionContent } from '../domain/runtimeConfig';
import { contentHashOf } from '../domain/runtimeConfig';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { manageConfigUseCases } from './manageConfigs';
import { adminOnly } from './toDto';

/**
 * 保存草稿 = 追加一个新版本并把 draftRevision 指向它；已启用版本不动。
 * expectedRevision 比较失败保留对方的草稿并报 409；凭据在同一事务内加密写入。
 */
export function saveDraftUseCase(deps: AgentRuntimeUseCaseDeps) {
  const { uow, cipher, clock } = deps;
  const { getConfig } = manageConfigUseCases(deps);
  return async (actor: Actor, id: RuntimeConfigId, input: SaveRuntimeDraftRequest): Promise<RuntimeConfigDetailDto> => {
    adminOnly(actor);
    const content: RuntimeRevisionContent = { steps: input.steps, vars: input.vars, secretNames: [...new Set(input.secretNames)], configFile: input.configFile, ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}), models: input.models };
    validateRevisionContent(content);
    const existing = new Set((await uow.read.credentials.list(id)).map((c) => c.name));
    const plan = planCredentialWrites(existing, content.secretNames, input.credentials);
    const encrypted = await Promise.all(plan.replace.map(async ({ name, value }) => ({ name, cipherText: await cipher.encrypt(value) })));
    const now = clock.now();
    await uow.run(async (scope) => {
      const config = await scope.configs.lockById(id);
      if (!config) throw notFound('运行环境', id);
      if (config.draftRevision !== input.expectedRevision) throw conflict(`运行环境草稿已被修改（当前版本 ${config.draftRevision}），你的草稿已保留，请对照后再保存`, { code: 'draft_revision_conflict', currentRevision: config.draftRevision });
      const revision: RuntimeRevision = { ...content, configId: id, revision: config.draftRevision + 1, contentHash: contentHashOf(content), createdBy: actor.userId, createdAt: now };
      await scope.revisions.insert(revision);
      for (const credential of encrypted) await scope.credentials.upsert({ configId: id, name: credential.name, cipherText: credential.cipherText, updatedBy: actor.userId, updatedAt: now });
      for (const name of plan.clear) await scope.credentials.remove(id, name);
      await scope.configs.update({ ...config, draftRevision: revision.revision, ...(input.description === undefined ? {} : { description: input.description }), updatedBy: actor.userId, updatedAt: now });
    });
    return getConfig(actor, id);
  };
}
