import type { BusinessNativeConfig, PlatformOpencodeModels } from '@crewstation/contracts';

/** Native options are opaque application data. Keep every string leaf out of
 * public events, just as for MCP environment/header values. */
export function businessMaterialSecrets(native: BusinessNativeConfig | undefined, models?: PlatformOpencodeModels): string[] {
  const values: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === 'string') { if (value) values.push(value); }
    else if (Array.isArray(value)) for (const child of value) collect(child);
    else if (value && typeof value === 'object') for (const child of Object.values(value)) collect(child);
  };
  for (const mcp of native?.mcp ?? []) {
    collect(mcp.type === 'local' ? mcp.env : mcp.headers);
    if (mcp.type === 'remote' && mcp.oauth) collect(mcp.oauth.clientSecret);
  }
  for (const plugin of native?.plugins ?? []) collect(plugin.options);
  // Structured provider material (RFC-040 V12): forwarded credential values and the operator's option leaves.
  for (const entry of Object.values(models?.providers ?? {})) { collect(entry.secrets); collect(entry.provider.options); }
  return [...new Set(values)];
}
