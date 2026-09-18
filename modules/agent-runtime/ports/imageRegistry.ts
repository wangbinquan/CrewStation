import type { RegistryLayout } from '../domain/imageReference';

/** 平台镜像仓库（C15）：布局来自安装配置；摘要解析走仓库的 HTTP API。 */
export interface ImageRegistry {
  readonly layout: RegistryLayout;
  /** 按标签或摘要查清单，返回 sha256 摘要；标签不存在或仓库不可达时抛 validation／unavailable。 */
  resolveDigest(repository: string, reference: { tag?: string; digest?: string }): Promise<string>;
}
