export interface NativeDeletionSettings {
  readonly gitlab: { readonly baseUrl: string; readonly token: string;
    readonly instance: { readonly id: string; readonly image: string; readonly startedAt: string; readonly epoch: string } };
  readonly grantToken: string;
  readonly registry?: { readonly baseUrl: string; readonly token: string; readonly sourceIdentity: string; readonly journalIdentity: string };
}
/** A missing source stays disabled; a partially configured source fails at startup. */
export function nativeDeletionSettings(env: Record<string, string | undefined>): NativeDeletionSettings | undefined {
  if (!env.CS_PROJECT_DELETION_GITLAB_SOURCE && !env.CS_PROJECT_DELETION_SOURCE_TOKEN && !env.CS_PROJECT_DELETION_GRANT_TOKEN && !env.CS_PROJECT_DELETION_REGISTRY_SOURCE && !env.CS_PROJECT_DELETION_REGISTRY_TOKEN) return undefined;
  try {
    const source: unknown = JSON.parse(env.CS_PROJECT_DELETION_GITLAB_SOURCE ?? '');
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw Error();
    const row = source as Record<string, unknown>, raw = row['instance'];
    if (Object.keys(row).sort().join() !== 'baseUrl,instance' || typeof row['baseUrl'] !== 'string' || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
    const instance = raw as Record<string, unknown>;
    if (Object.keys(instance).sort().join() !== 'epoch,id,image,startedAt' || Object.values(instance).some(value => typeof value !== 'string')) throw Error();
    const { id, image, startedAt, epoch } = instance as NativeDeletionSettings['gitlab']['instance'];
    const base = new URL(row['baseUrl']);
    const token = env.CS_PROJECT_DELETION_SOURCE_TOKEN ?? '', grantToken = env.CS_PROJECT_DELETION_GRANT_TOKEN ?? '';
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/'
      || !/^[a-f0-9]{64}$/.test(id) || !/^sha256:[a-f0-9]{64}$/.test(image) || !/^[a-f0-9]{64}$/.test(epoch)
      || !Number.isFinite(Date.parse(startedAt)) || token.length < 32 || grantToken.length < 32 || token === grantToken) throw Error();
    let registry: NativeDeletionSettings['registry'];
    if (env.CS_PROJECT_DELETION_REGISTRY_SOURCE || env.CS_PROJECT_DELETION_REGISTRY_TOKEN) {
      const raw: unknown = JSON.parse(env.CS_PROJECT_DELETION_REGISTRY_SOURCE ?? '');
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
      const row = raw as Record<string, unknown>, registryToken = env.CS_PROJECT_DELETION_REGISTRY_TOKEN ?? '';
      if (Object.keys(row).sort().join() !== 'baseUrl,journalIdentity,sourceIdentity' || typeof row['baseUrl'] !== 'string'
        || typeof row['sourceIdentity'] !== 'string' || !/^[a-f0-9]{64}$/.test(row['sourceIdentity']) || typeof row['journalIdentity'] !== 'string' || !/^[a-f0-9]{64}$/.test(row['journalIdentity'])
        || registryToken.length < 32 || [token, grantToken].includes(registryToken)) throw Error();
      const url = new URL(row['baseUrl']);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
      registry = { baseUrl: url.toString(), sourceIdentity: row['sourceIdentity'], journalIdentity: row['journalIdentity'], token: registryToken };
    }
    return { gitlab: { baseUrl: base.toString(), instance: { id, image, startedAt, epoch }, token }, grantToken, ...(registry ? { registry } : {}) };
  } catch { throw Error('永久删除 GitLab 原安装、独立来源凭据与控制器许可配置不完整'); }
}
