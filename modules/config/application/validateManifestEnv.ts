import type { ConfigEnv, EnvEntry, ManifestEnvValidation, ProjectId } from '@crewstation/contracts';
import { missingKeys } from '../domain/configVersion';
import type { ConfigUseCaseDeps } from './dependencies';

/** Manifest env 段引用的键（key 缺省取 name）必须已存在于目标取值组；release 在构建前、dev-session 在启动前调用。 */
export function validateManifestEnvUseCase({ uow }: ConfigUseCaseDeps) {
  return async (projectId: ProjectId, env: ConfigEnv, entries: readonly EnvEntry[]): Promise<ManifestEnvValidation> => ({
    missing: missingKeys(entries, await uow.read.items.list(projectId, env)),
  });
}
