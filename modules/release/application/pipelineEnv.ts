import type { Manifest, ProjectId, ServiceId } from '@crewstation/contracts';
import { PLATFORM_ENV } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { PhysicalSlot } from '../domain/slots';
import type { ReleaseUseCaseDeps } from './dependencies';

export interface RenderedEnv { values: Record<string, string>; configVersion: number }

/** 槽容器的环境：平台约定变量＋生产组配置＋生产数据连接；缺失的配置键在此拒绝，不进入部署。 */
export async function renderSlotEnv(deps: Pick<ReleaseUseCaseDeps, 'config' | 'data' | 'settings'>, input: { projectId: ProjectId; serviceId: ServiceId; projectSlug: string; serviceName: string; physical: PhysicalSlot; manifest: Manifest }): Promise<RenderedEnv> {
  const { manifest } = input;
  const keys = manifest.spec.env.map((e) => e.configDefinitionId);
  const { missing } = await deps.config.validate(input.projectId, 'production', keys);
  // 声明了 default 的键可以缺席：取 Manifest 里的兜底值；其余缺失键一律拒绝，不进入部署。
  const defaults = new Map(manifest.spec.env.filter((e) => e.default !== undefined).map((e) => [e.configDefinitionId, e.default as string]));
  const blocking = missing.filter((key) => !defaults.has(key));
  if (blocking.length > 0) throw validation(`生产组配置缺少 Manifest env 段声明的键：${blocking.join('、')}`, { missing: blocking });
  const config = await deps.config.render(input.projectId, 'production');
  const data = await deps.data.envFor(input.serviceId, 'production');
  const declared: Record<string, string> = {};
  for (const entry of manifest.spec.env) {
    const key = entry.configDefinitionId;
    const value = config.values[key] ?? defaults.get(key);
    if (value !== undefined) declared[entry.name] = value;
  }
  const values: Record<string, string> = {
    ...data,
    ...declared,
    [PLATFORM_ENV.project]: input.projectSlug,
    [PLATFORM_ENV.service]: input.serviceName,
    [PLATFORM_ENV.slot]: input.physical,
    [PLATFORM_ENV.environment]: 'production',
    [PLATFORM_ENV.userDomain]: deps.settings.userDomain,
    [PLATFORM_ENV.serviceDomain]: deps.settings.serviceDomain,
    [PLATFORM_ENV.platformApiUrl]: `http://api.${deps.settings.serviceDomain}`,
    [PLATFORM_ENV.internalApiBase]: `http://api.${deps.settings.serviceDomain}/api/`,
    [PLATFORM_ENV.jwksUrl]: `http://api.${deps.settings.serviceDomain}/.well-known/jwks.json`,
    [PLATFORM_ENV.port]: String(manifest.spec.service.port),
  };
  return { values, configVersion: config.version };
}
