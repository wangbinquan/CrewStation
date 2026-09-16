import type { AgentRuntimeMaterial, RuntimeConfigId } from '@crewstation/contracts';
import { notFound, precondition } from '@crewstation/kernel';
import type { RuntimeConfig, RuntimeRevision } from '../domain/runtimeConfig';
import { assertResolvable } from '../domain/runtimeConfig';
import type { AgentRuntimeUseCaseDeps } from './dependencies';

export interface ResolveOptions { captureOutput?: boolean }

/**
 * 把一个固定版本变成启动材料：解密声明的凭据，缺值即拒绝（指向管理员）。
 * 材料是瞬时的，只经受控 Runner 命令通道发往目标任务；调用方不得落库或记日志。
 */
export function resolveRuntimeUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, cipher } = deps;
  const materialFor = async (config: RuntimeConfig, revision: RuntimeRevision, options: ResolveOptions = {}): Promise<AgentRuntimeMaterial> => {
    const stored = await uow.read.credentials.list(config.id);
    const secrets: Record<string, string> = {};
    for (const name of revision.secretNames) {
      const found = stored.find((c) => c.name === name);
      if (!found) throw precondition(`运行环境 ${config.name} 的凭据 ${name} 尚未设置，请管理员在平台管理里补齐`, { code: 'runtime_secret_missing', configId: config.id, name });
      secrets[name] = await cipher.decrypt(found.cipherText);
    }
    return {
      configId: config.id, configName: config.name, revision: revision.revision, driver: config.driver, contentHash: revision.contentHash,
      steps: revision.steps, vars: { ...revision.vars }, secrets, configFile: revision.configFile, captureOutput: options.captureOutput ?? false,
    };
  };
  const loadRevision = async (config: RuntimeConfig, revision: number): Promise<RuntimeRevision> => {
    const found = await uow.read.revisions.get(config.id, revision);
    if (!found) throw notFound('运行环境版本', `${config.id}@${revision}`);
    return found;
  };
  return {
    materialFor,
    /** 受理新启动时用：已启用配置的已启用版本；停用或未启用报可恢复的 precondition。 */
    resolveActive: async (configId: string): Promise<AgentRuntimeMaterial> => {
      const config = await uow.read.configs.getById(configId as RuntimeConfigId);
      if (!config) throw precondition('绑定的运行环境已不存在，请管理员重新绑定档位', { code: 'runtime_config_missing', configId });
      return materialFor(config, await loadRevision(config, assertResolvable(config)));
    },
    /** 重试、重连或后台派发同一次受理时用：固定版本，不再看“当前最新”，停用也不改变已受理的执行。 */
    resolveRevision: async (configId: string, revision: number): Promise<AgentRuntimeMaterial> => {
      const config = await uow.read.configs.getById(configId as RuntimeConfigId);
      if (!config) throw precondition('运行环境已不存在', { code: 'runtime_config_missing', configId });
      return materialFor(config, await loadRevision(config, revision));
    },
  };
}
