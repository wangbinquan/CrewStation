import { PlatformError, validation } from '@crewstation/kernel';
import { z } from 'zod';
import { RuntimeImageDigestSchema } from '@crewstation/contracts';
import type { RuntimeRegistryLayout } from '../../domain/registryReference';

const Descriptor = z.object({ digest: RuntimeImageDigestSchema, mediaType: z.string(), size: z.number().int().min(0), platform: z.object({ os: z.string(), architecture: z.string(), variant: z.string().optional() }).optional() });
export const ManifestDocument = z.object({ schemaVersion: z.literal(2), mediaType: z.string().optional(), config: Descriptor, layers: z.array(Descriptor) });
export const IndexDocument = z.object({ schemaVersion: z.literal(2), manifests: z.array(Descriptor) });
export const ConfigDocument = z.object({ os: z.string(), architecture: z.string(), rootfs: z.object({ type: z.literal('layers'), diff_ids: z.array(RuntimeImageDigestSchema) }), config: z.object({ User: z.string().optional(), Entrypoint: z.array(z.string()).nullable().optional(), Cmd: z.array(z.string()).nullable().optional() }).passthrough() });
const ACCEPT = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json', 'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'].join(', ');
const unavailable = (message: string) => new PlatformError('unavailable', message);

async function boundedText(response: Response, maxBytes: number): Promise<{ text: string; digest: string }> {
  if (Number(response.headers.get('content-length')) > maxBytes) throw unavailable('镜像元数据超出大小限制');
  if (!response.body) throw unavailable('镜像元数据为空');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }), hash = new Bun.CryptoHasher('sha256');
  let bytes = 0, text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw unavailable('镜像元数据超出大小限制');
      hash.update(part.value);
      text += decoder.decode(part.value, { stream: true });
    }
    return { text: text + decoder.decode(), digest: `sha256:${hash.digest('hex')}` };
  } finally { await reader.cancel(); reader.releaseLock(); }
}

/** 使用响应字节复核 digest，而不是相信 Dockerfile 的日志或仓库响应头。只访问已配置仓库且不跟随重定向。 */
export function registryDocuments(layout: RuntimeRegistryLayout, fetcher: typeof fetch = fetch, timeoutMs = 10000) {
  return async (repository: string, kind: 'manifests' | 'blobs', reference: string) => {
    let response: Response;
    try { response = await fetcher(`${layout.scheme}://${layout.pullBase}/v2/${repository}/${kind}/${encodeURIComponent(reference)}`, { headers: { Accept: ACCEPT }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw unavailable('平台镜像仓库不可达'); }
    if (response.status === 404) throw validation('平台仓库中不存在所选镜像或内容');
    if (!response.ok) throw unavailable(`平台镜像仓库返回 ${response.status}`);
    const { text, digest } = await boundedText(response, 4 * 1024 * 1024), reported = response.headers.get('Docker-Content-Digest');
    if ((reference.startsWith('sha256:') && reference !== digest) || (reported && reported !== digest)) throw unavailable('平台镜像仓库的内容与摘要不匹配');
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw unavailable('平台镜像仓库返回无效 JSON'); }
    return { value, digest };
  };
}
