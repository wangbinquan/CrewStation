/**
 * 档位镜像只允许来自平台镜像仓库（RFC-006 C15）。管理员可以填集群内拉取地址、推送主机地址或仓库内路径，
 * 这里统一规范化为集群内拉取地址；仓库路径必须在 runtime/ 前缀下，或者就是平台底座镜像本身（C5：可直接用底座里的官方 CLI）。
 */
export interface RegistryLayout {
  /** 集群内拉取与构建推送用的仓库前缀（settings.registryBase），如 registry.crewstation-system.svc.cluster.local:5000。 */
  readonly pullBase: string;
  /** 管理员从工作机推送用的主机名（经网关），如 registry.cs.localhost。 */
  readonly pushHost: string;
  /** 平台底座镜像在仓库里的路径，如 crewstation/task-runtime。 */
  readonly baseRepository: string;
  /** 管理员镜像必须放在这个前缀下，如 runtime/。 */
  readonly runtimePrefix: string;
}

export interface ImageReference {
  readonly repository: string;
  readonly tag?: string;
  readonly digest?: string;
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

function stripRegistry(input: string, layout: RegistryLayout): string | undefined {
  for (const host of [layout.pullBase, layout.pushHost]) if (input.startsWith(`${host}/`)) return input.slice(host.length + 1);
  const firstSegment = input.split('/')[0] ?? '';
  // 第一段带点、冒号或就是 localhost 的，是别的仓库主机：不接受（C15）。
  if (firstSegment.includes('.') || firstSegment.includes(':') || firstSegment === 'localhost') return undefined;
  return input;
}

/** 解析并校验；失败返回给管理员看的原因。 */
export function parseProfileImage(input: string, layout: RegistryLayout): { ok: true; image: ImageReference } | { ok: false; reason: string } {
  const trimmed = input.trim();
  const path = stripRegistry(trimmed, layout);
  if (path === undefined) return { ok: false, reason: `镜像必须放在平台镜像仓库：请推送到 ${layout.pushHost}/${layout.runtimePrefix}… 后填写仓库内路径` };
  const [nameAndTag = '', digest] = path.split('@') as [string, string | undefined];
  if (digest !== undefined && !DIGEST_RE.test(digest)) return { ok: false, reason: `镜像摘要 ${digest} 不是 sha256:<64 位十六进制>` };
  const colon = nameAndTag.lastIndexOf(':');
  const repository = colon > nameAndTag.lastIndexOf('/') && colon >= 0 ? nameAndTag.slice(0, colon) : nameAndTag;
  const tag = colon > nameAndTag.lastIndexOf('/') && colon >= 0 ? nameAndTag.slice(colon + 1) : undefined;
  if (!REPOSITORY_RE.test(repository)) return { ok: false, reason: `镜像仓库路径 ${repository} 不合法` };
  if (tag !== undefined && !TAG_RE.test(tag)) return { ok: false, reason: `镜像标签 ${tag} 不合法` };
  if (!repository.startsWith(layout.runtimePrefix) && repository !== layout.baseRepository) return { ok: false, reason: `镜像必须在 ${layout.runtimePrefix} 前缀下，或直接使用平台底座 ${layout.baseRepository}` };
  if (tag === undefined && digest === undefined) return { ok: false, reason: '镜像需要标签或摘要，例如 runtime/my-cli:1.0' };
  return { ok: true, image: { repository, ...(tag === undefined ? {} : { tag }), ...(digest === undefined ? {} : { digest }) } };
}

/** 存进修订内容的拉取引用（不含摘要；摘要单独固定）。 */
export function pullReference(image: ImageReference, layout: RegistryLayout): string {
  return `${layout.pullBase}/${image.repository}${image.tag ? `:${image.tag}` : ''}`;
}

/** Pod 里用的固定引用：永远按摘要拉，重推同一标签不会悄悄换掉已测试的镜像。 */
export function pinnedReference(repository: string, digest: string, layout: RegistryLayout): string {
  return `${layout.pullBase}/${repository}@${digest}`;
}

/** 从修订里存的拉取引用反推仓库路径。 */
export function repositoryOf(reference: string, layout: RegistryLayout): string {
  const path = reference.startsWith(`${layout.pullBase}/`) ? reference.slice(layout.pullBase.length + 1) : reference;
  const nameAndTag = path.split('@')[0] ?? path;
  const colon = nameAndTag.lastIndexOf(':');
  return colon > nameAndTag.lastIndexOf('/') ? nameAndTag.slice(0, colon) : nameAndTag;
}
