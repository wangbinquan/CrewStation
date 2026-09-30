import type { ProjectId } from '@crewstation/contracts';
import { ProjectIdSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { PushGrant } from '../domain/pushGrant';

function projectOf(path: string): ProjectId | undefined {
  if (!path.startsWith('runtime/projects/')) return undefined;
  const value = path.slice('runtime/projects/'.length).split('/')[0];
  if (!ProjectIdSchema.safeParse(value).success) throw precondition('项目镜像路径缺少有效的项目身份');
  return value as ProjectId;
}
/** Scope of old signed build grants is carried by their immutable push prefix. Mount also reads its source. */
export function registryProjects(grant: PushGrant, uri: string): ProjectId[] {
  const own = grant.push.map(projectOf), target = projectOf(uri.split('?')[0]?.replace(/^\/v2\//, '') ?? '');
  const query = new URLSearchParams(uri.includes('?') ? uri.slice(uri.indexOf('?') + 1) : '');
  return [...new Set([...own, target, ...query.getAll('from').map(projectOf)].filter((id): id is ProjectId => id !== undefined))].sort();
}
