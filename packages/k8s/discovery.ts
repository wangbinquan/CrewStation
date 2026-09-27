import { validation } from '@crewstation/kernel';
import type { ResourceRef } from './resources';

/** 首选版本优先，补齐仅存在于其他版本的种类；不猜复数名，不把子资源当独立对象。 */
export async function discoverNamespaced(read: (path: string) => Promise<unknown>): Promise<ResourceRef[]> {
  const core = await read('/api') as { versions?: string[] };
  const grouped = await read('/apis') as { groups?: Array<{ preferredVersion?: { groupVersion?: string }; versions?: Array<{ groupVersion: string }> }> };
  if (!core.versions?.length || !Array.isArray(grouped.groups)) throw validation('Kubernetes API discovery 不完整');
  const versions = [...core.versions.map((version) => ({ path: `/api/${version}`, version })), ...grouped.groups.flatMap((group) => {
    const version = group.preferredVersion?.groupVersion;
    if (!version) throw validation('Kubernetes API 组缺少首选版本');
    return [...new Set([version, ...(group.versions ?? []).map((entry) => entry.groupVersion)])].map((entry) => ({ path: `/apis/${entry}`, version: entry }));
  })];
  const refs = new Map<string, ResourceRef>();
  for (const { path, version } of versions) {
    const list = await read(path) as { resources?: Array<{ name: string; kind: string; namespaced: boolean; verbs: string[] }> };
    if (!Array.isArray(list.resources)) throw validation(`Kubernetes API ${version} discovery 不完整`);
    for (const resource of list.resources) {
      if (!resource.namespaced || resource.name.includes('/') || !resource.verbs.includes('list')) continue;
      if (!resource.name || !resource.kind) throw validation('Kubernetes API 资源信息不完整');
      const key = `${version.includes('/') ? version.split('/')[0] : ''}/${resource.name}`;
      if (!refs.has(key)) refs.set(key, { apiVersion: version, kind: resource.kind, plural: resource.name, namespaced: true });
    }
  }
  return [...refs.values()];
}
