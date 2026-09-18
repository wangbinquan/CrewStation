import { PlatformError, validation } from '@crewstation/kernel';
import type { RegistryLayout } from '../../domain/imageReference';
import type { ImageRegistry } from '../../ports/imageRegistry';

const unavailable = (message: string): PlatformError => new PlatformError('unavailable', message);

/** 多架构索引与单清单都要接受：摘要取仓库返回的 Docker-Content-Digest，与 kubelet 解析出的一致。 */
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export interface HttpImageRegistryOptions {
  readonly layout: RegistryLayout;
  /** 集群内访问平台仓库的协议；本机 registry:3 是 http。 */
  readonly scheme: 'http' | 'https';
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** 平台仓库的 HTTP API：HEAD /v2/<repo>/manifests/<ref>。只读，不做推送。 */
export function httpImageRegistry(options: HttpImageRegistryOptions): ImageRegistry {
  const fetcher = options.fetch ?? fetch;
  return {
    layout: options.layout,
    resolveDigest: async (repository, reference) => {
      const ref = reference.digest ?? reference.tag;
      if (!ref) throw validation('镜像需要标签或摘要');
      const url = `${options.scheme}://${options.layout.pullBase}/v2/${repository}/manifests/${encodeURIComponent(ref)}`;
      let response: Response;
      try { response = await fetcher(url, { method: 'HEAD', headers: { Accept: MANIFEST_ACCEPT }, signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) }); }
      catch (error) { throw unavailable(`平台镜像仓库不可达：${error instanceof Error ? error.message : String(error)}`); }
      if (response.status === 404) throw validation(`平台仓库里找不到镜像 ${repository}:${ref}，请先推送`, { field: 'content.image' });
      if (!response.ok) throw unavailable(`平台镜像仓库返回 ${response.status}`);
      const digest = response.headers.get('docker-content-digest');
      if (!digest || !/^sha256:[0-9a-f]{64}$/.test(digest)) throw unavailable('平台镜像仓库没有返回清单摘要');
      if (reference.digest && reference.digest !== digest) throw validation(`镜像摘要与仓库不一致：填写 ${reference.digest}，仓库 ${digest}`, { field: 'content.image' });
      return digest;
    },
  };
}
