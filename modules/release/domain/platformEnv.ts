import type { SlotName } from '@crewstation/contracts';
import { PLATFORM_ENV } from '@crewstation/contracts';

export interface PlatformEnvInput {
  projectSlug: string;
  serviceName: string;
  role: SlotName;
  port: number;
  userDomain: string;
  serviceDomain: string;
}

/** 业务接入约定表里的平台环境变量（Plan T0.3）；两槽都是 production 环境。 */
export function platformEnv(input: PlatformEnvInput): Record<string, string> {
  return {
    [PLATFORM_ENV.project]: input.projectSlug,
    [PLATFORM_ENV.service]: input.serviceName,
    [PLATFORM_ENV.slot]: input.role,
    [PLATFORM_ENV.environment]: 'production',
    [PLATFORM_ENV.userDomain]: input.userDomain,
    [PLATFORM_ENV.serviceDomain]: input.serviceDomain,
    [PLATFORM_ENV.platformApiUrl]: `http://api.${input.serviceDomain}`,
    [PLATFORM_ENV.internalApiBase]: `http://api.${input.serviceDomain}/api/`,
    [PLATFORM_ENV.jwksUrl]: `http://api.${input.serviceDomain}/.well-known/jwks.json`,
    [PLATFORM_ENV.port]: String(input.port),
  };
}
