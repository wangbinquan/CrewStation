export type { ActorResolver, EnsureRepositoryInput, ListBranchesOptions, ScmModuleApi, ScmRepositoryWriteHistory } from './api/moduleApi';
export { createScmModule, scmMigrations, gitLabNativeOriginsAdapter } from './wiring';
export type { ScmModule, ScmModuleDeps } from './wiring';
