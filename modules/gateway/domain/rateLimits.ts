import type { ProjectRateLimitOverride, RateLimits } from '@crewstation/contracts';

/** 平台默认那一行的范围名；项目覆盖的范围名是项目 ID。 */
export const PLATFORM_RATE_LIMIT_SCOPE = 'platform';

/**
 * 限流的初始默认值（RFC-025 提案 Q4）：设计取值，未经压测，T15 用突发脚本在本机校准后报作者再定。
 * 两个「合计」只给了平均，突发按平均的两倍（与其余几项的比例一致）。
 */
export const DEFAULT_RATE_LIMITS: RateLimits = {
  platformApi: { perUser: { average: 20, burst: 40 }, inFlightPerUser: 16 },
  userDomain: { perUser: { average: 30, burst: 60 }, perHost: { average: 300, burst: 600 } },
  serviceDomain: { perSource: { average: 50, burst: 100 }, perTarget: { average: 500, burst: 1000 } },
};

/** 项目生效的用户域与服务域：覆盖里写了的那一项整项照它，没写的照平台默认。 */
export function effectiveProjectLimits(platform: RateLimits, override: ProjectRateLimitOverride | undefined): Pick<RateLimits, 'userDomain' | 'serviceDomain'> {
  return { userDomain: override?.userDomain ?? platform.userDomain, serviceDomain: override?.serviceDomain ?? platform.serviceDomain };
}
