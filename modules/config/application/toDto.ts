import type { ConfigItemDto, ConfigVersionDto } from '@crewstation/contracts';
import type { ConfigItem } from '../domain/configItem';
import type { ConfigVersion } from '../domain/configVersion';
import { keysOf } from '../domain/configVersion';

/** Secret 只写不读：isSecret 时不带 value 字段。 */
export function itemToDto(item: ConfigItem): ConfigItemDto {
  return {
    name: item.name,
    env: item.env,
    isSecret: item.isSecret,
    ...(item.isSecret ? {} : { value: item.value }),
    version: item.version,
    updatedBy: item.updatedBy,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function versionToDto(version: ConfigVersion): ConfigVersionDto {
  return { env: version.env, version: version.version, createdAt: version.createdAt.toISOString(), keys: keysOf(version.entries) };
}
