import { validation } from '@crewstation/kernel';

export interface RuntimeRegistryLayout { readonly pullBase: string; readonly pushHost: string; readonly scheme: 'http' | 'https' }
export interface RegistryImageName { readonly repository: string; readonly reference: string }
export interface RegistryRepositoryAccess { readonly exact?: readonly string[]; readonly prefixes?: readonly string[] }

/** 镜像路径必须落在平台仓库且有精确前缀授权；拒绝 URL、额外 @、编码路径与主机前缀伪装。 */
export function parseRuntimeImageReference(input: string, layout: RuntimeRegistryLayout, access: RegistryRepositoryAccess): RegistryImageName {
  let path = input.trim();
  if (/[\x00-\x20\x7f%?#\\]/.test(path) || path.includes('://')) throw validation('请填写平台镜像引用，不接受 URL 或编码路径');
  const registry = [layout.pullBase, layout.pushHost].find((host) => path.startsWith(`${host}/`));
  if (registry) path = path.slice(registry.length + 1);
  const parts = path.split('@');
  if (parts.length > 2) throw validation('镜像引用包含多个摘要');
  const name = parts[0]!, digest = parts[1], colon = name.lastIndexOf(':');
  const hasTag = colon > name.lastIndexOf('/'), repository = hasTag ? name.slice(0, colon) : name, tag = hasTag ? name.slice(colon + 1) : undefined;
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/.test(repository)) throw validation('平台镜像仓库路径不合法');
  if (digest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(digest)) throw validation('镜像摘要必须为 sha256');
  if (tag !== undefined && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) throw validation('镜像标签不合法');
  if (!digest && !tag) throw validation('镜像需要标签或摘要');
  if (!access.exact?.includes(repository) && !access.prefixes?.some((prefix) => repository.startsWith(`${prefix.replace(/\/+$/, '')}/`))) throw validation('此镜像不属于项目可使用的平台仓库前缀');
  return { repository, reference: digest ?? tag! };
}
