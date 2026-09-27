import type { ImageBuild, ImageRevision } from '../domain/records';

/** 凭据只送入本次构建的 Secret；持久层只保存可撤销的凭据 ID。 */
export interface RuntimeBuildCredentials {
  issueGit(build: ImageBuild, revision: ImageRevision): Promise<{ id: string; token: string }>;
  revokeGit(revision: ImageRevision, credentialId: string): Promise<void>;
  push(build: ImageBuild, revision: ImageRevision): Promise<{ host: string; username: string; password: string }>;
  packages(build: ImageBuild, revision: ImageRevision): Promise<Readonly<Record<string, string>>>;
}
