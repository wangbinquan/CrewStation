import type { ServiceId } from '@crewstation/contracts';

/** 由 scm 模块提供：只有平台能创建发布标签；读取标签处的文件用于取 Manifest 与 OpenAPI。 */
export interface ReleaseTagger {
  createReleaseTag(serviceId: ServiceId, input: { branch: string; version: string; expectedCommitSha?: string }): Promise<{ tag: string; commitSha: string }>;
}

export interface RepoReader {
  readFile(serviceId: ServiceId, ref: string, path: string): Promise<string | undefined>;
  /** 旧形状：仓库地址，并写好按服务共用的 Git 凭据 Secret（构建 Job 引用它的名字）。 */
  repositoryUrl(serviceId: ServiceId): Promise<{ httpUrl: string; credentialSecretName: string }>;
  /**
   * 资源中心建的构建 Job（RFC-025 T8）：仓库地址（不含凭据，写进期望）与这一次构建用的只读令牌（调和器建凭据 Secret 时才签，值不落库）。
   * 两个都给了才由资源中心建 Job。
   */
  buildSource?(serviceId: ServiceId): Promise<{ httpUrl: string }>;
  buildToken?(serviceId: ServiceId): Promise<{ token: string }>;
}
