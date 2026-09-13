import type { ServiceId } from '@crewstation/contracts';

/** 由 scm 模块提供：只有平台能创建发布标签；读取标签处的文件用于取 Manifest 与 OpenAPI。 */
export interface ReleaseTagger {
  createReleaseTag(serviceId: ServiceId, input: { branch: string; version: string; expectedCommitSha?: string }): Promise<{ tag: string; commitSha: string }>;
}

export interface RepoReader {
  readFile(serviceId: ServiceId, ref: string, path: string): Promise<string | undefined>;
  repositoryUrl(serviceId: ServiceId): Promise<{ httpUrl: string; credentialSecretName: string }>;
}
