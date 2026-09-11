import type { ResolvedHost } from '../domain/hosts';

/** 用户域 Host → 目标；缺省实现按 contracts HOST_PATTERNS 与安装的用户域推导。 */
export interface HostResolver {
  resolveHost(host: string): Promise<ResolvedHost | undefined>;
}
