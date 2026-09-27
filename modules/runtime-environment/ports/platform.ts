import type { RuntimeImageSecretVersion, Actor, RuntimeImageSource, RuntimeImageVersionDto, RuntimeImageRevisionDto, RuntimeImageValidationTarget } from '@crewstation/contracts';

export interface RuntimeImageAuthorizer {
  authorize(actor: Actor, projectId: string, action: 'view' | 'develop' | 'manage'): Promise<void>;
}
export interface PreparedImageSource { readonly source: RuntimeImageSource; readonly commitSha?: string; readonly baseImage?: string }
/** 核对 SCM／registry 归属并固定 SHA／digest；不接收用户传来的任意 URL 或凭据值。 */
export interface RuntimeImageSourceResolver {
  prepare(actor: Actor, projectId: string, source: RuntimeImageSource): Promise<PreparedImageSource>;
}
/** 包含平台 Runner／协议版本以及精确档位内容和凭据戳；只返回摘要，不存模型凭据。 */
export interface RuntimeImageValidationContracts {
  profileRevision?(actor: Actor, projectId: string, profileId: string): Promise<{ profileId: string; revision: number }>;
  secretVersions?(actor: Actor, projectId: string, revision: RuntimeImageRevisionDto): Promise<RuntimeImageSecretVersion[]>;
  fingerprint(actor: Actor, projectId: string, version: RuntimeImageVersionDto, revision: RuntimeImageRevisionDto, target: RuntimeImageValidationTarget): Promise<string>;
}
export interface RuntimeImageLimits {
  readonly platformBuilds: number;
  readonly projectBuilds: number;
  readonly buildTimeoutSeconds: number;
  readonly logRetentionSeconds: number;
  readonly logMaxBytes: number;
}

/** 只接受已授权并固定的配置版本；不读取当前值。 */
export interface RuntimeInitializationSecrets {
  render(projectId: string, stamps: readonly RuntimeImageSecretVersion[]): Promise<Record<string, string>>;
}
