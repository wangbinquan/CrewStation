import type { RuntimeImageExecutionSnapshot, RuntimeImageInitializer, RuntimeImageSecretVersion } from '@crewstation/contracts';
import { RuntimeImageExecutionSnapshotSchema, RuntimeImageSecretVersionSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ImageReferenceOwner } from '../api/bindings';
import { imageContentDigest } from '../domain/contentDigest';
import type { RuntimeImageDeps } from './dependencies';

export function checkedSecretVersions(initializer: RuntimeImageInitializer, stamps: readonly RuntimeImageSecretVersion[]): RuntimeImageSecretVersion[] {
  const required = new Set(initializer.secrets.map((s) => `${s.environment}:${s.configDefinitionId}`));
  const parsed = stamps.map((s) => RuntimeImageSecretVersionSchema.parse(s));
  const found = new Set(parsed.map((s) => `${s.environment}:${s.definitionId}`));
  if (found.size !== parsed.length || found.size !== required.size || [...found].some((key) => !required.has(key))) throw precondition('初始化 Secret 版本与显式引用不一致');
  return parsed.sort((a, b) => `${a.environment}:${a.definitionId}`.localeCompare(`${b.environment}:${b.definitionId}`));
}

/** 只有已有的项目执行引用可以物化凭据，禁止借内部入口构造任意历史配置读取。 */
export function renderInitializationSecrets(deps: RuntimeImageDeps) {
  return async (projectId: string, owner: ImageReferenceOwner, input: RuntimeImageExecutionSnapshot): Promise<Record<string, string>> => {
    const snapshot = RuntimeImageExecutionSnapshotSchema.parse(input);
    const reference = await deps.uow.read.references.get(snapshot.versionId, owner.type, owner.id);
    if (reference?.projectId !== projectId || !reference.snapshot || imageContentDigest(reference.snapshot) !== imageContentDigest(snapshot)) throw precondition('初始化凭据必须绑定已保留的执行快照');
    const stamps = checkedSecretVersions(snapshot.initializer, snapshot.initializerSecretVersions ?? []);
    if (!stamps.length) return {};
    if (!deps.initializationSecrets) throw precondition('初始化凭据物化端口尚未配置');
    const selected = await deps.initializationSecrets.render(projectId, stamps), values: Record<string, string> = {};
    for (const ref of snapshot.initializer.secrets) {
      const value = selected[`${ref.environment}:${ref.configDefinitionId}`];
      if (value === undefined) throw precondition('固定的初始化 Secret 不可用');
      values[ref.id] = value;
    }
    return values;
  };
}
