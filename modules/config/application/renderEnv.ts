import type { ConfigEnv, ProjectId } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ConfigVersionEntry } from '../domain/configVersion';
import type { ConfigUseCaseDeps } from './dependencies';

/**
 * 把某取值组渲染成环境变量键值（解密 Secret）。指定 version 时按快照回放，供 Release 部署与回退；
 * 不指定时取当前项。只供 release 与 task-runtime 在受信路径调用，不经 actor，绝不经 HTTP 暴露。
 */
export function renderEnvUseCase({ uow, cipher }: ConfigUseCaseDeps, byDefinition = false) {
  return async (projectId: ProjectId, env: ConfigEnv, version?: number): Promise<Record<string, string>> => {
    const entries = version === undefined ? await uow.read.items.list(projectId, env) : await snapshotEntries(projectId, env, version);
    const rendered: Record<string, string> = {};
    for (const entry of entries) rendered[byDefinition ? entry.definitionId : entry.bindingName] = entry.isSecret ? await cipher.decrypt(entry.value) : entry.value;
    return rendered;
  };

  async function snapshotEntries(projectId: ProjectId, env: ConfigEnv, version: number): Promise<readonly ConfigVersionEntry[]> {
    const snapshot = await uow.read.versions.get(projectId, env, version);
    if (!snapshot) throw notFound('配置版本', `${env}@${version}`);
    return snapshot.entries;
  }
}
