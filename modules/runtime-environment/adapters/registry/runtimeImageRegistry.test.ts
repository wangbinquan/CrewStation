import { expect, test } from 'bun:test';
import { httpRuntimeImageRegistry } from './runtimeImageRegistry';

const layout = { pullBase: 'registry.internal:5000', pushHost: 'registry.test', scheme: 'http' as const }, access = { prefixes: ['runtime/projects/p1'] };
const layer = `sha256:${'a'.repeat(64)}`;
function fixture() {
  const objects = new Map<string, string>(), calls: string[] = [];
  const add = (kind: string, value: unknown): string => {
    const text = JSON.stringify(value), digest = `sha256:${new Bun.CryptoHasher('sha256').update(text).digest('hex')}`;
    objects.set(`/v2/runtime/projects/p1/tool/${kind}/${digest}`, text); return digest;
  };
  const config = add('blobs', { os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [layer] }, config: { User: '1000', Cmd: ['sh'] } });
  const manifest = add('manifests', { schemaVersion: 2, config: { digest: config, mediaType: 'application/vnd.oci.image.config.v1+json', size: 100 }, layers: [{ digest: layer, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', size: 1 }] });
  objects.set('/v2/runtime/projects/p1/tool/manifests/v1', objects.get(`/v2/runtime/projects/p1/tool/manifests/${manifest}`)!);
  const fetcher = (async (input, init) => {
    calls.push(String(input));
    expect(init?.redirect).toBe('error');
    const found = objects.get(decodeURIComponent(new URL(String(input)).pathname));
    return found === undefined ? new Response('', { status: 404 }) : new Response(found);
  }) as typeof fetch;
  return { objects, calls, add, manifest, registry: httpRuntimeImageRegistry(layout, fetcher) };
}

test('按目标架构解析索引，最终版本固定单平台清单，复核 config 内容与层数', async () => {
  const f = fixture();
  expect(await f.registry.inspect('runtime/projects/p1/tool:v1', 'linux/amd64', access)).toMatchObject({ repository: `${layout.pullBase}/runtime/projects/p1/tool`, digest: f.manifest, diffIds: [layer], user: '1000', command: ['sh'] });
  const index = f.add('manifests', { schemaVersion: 2, manifests: [{ digest: f.manifest, mediaType: 'application/vnd.oci.image.manifest.v1+json', size: 100, platform: { os: 'linux', architecture: 'amd64' } }] });
  expect((await f.registry.inspect(`runtime/projects/p1/tool@${index}`, 'linux/amd64', access)).digest).toBe(f.manifest);
  await expect(f.registry.inspect(`runtime/projects/p1/tool@${index}`, 'linux/arm64', access)).rejects.toThrow('唯一匹配');
  await expect(f.registry.inspect('runtime/projects/p1/tool:v1', 'linux/arm64', access)).rejects.toThrow('实际架构');
});
test('伪造仓库内容、外项目路径、404 与不完整元数据不能登记为版本', async () => {
  const f = fixture();
  const count = f.calls.length;
  await expect(f.registry.inspect('runtime/projects/p2/tool:v1', 'linux/amd64', access)).rejects.toThrow('前缀');
  expect(f.calls).toHaveLength(count);
  await expect(f.registry.inspect('runtime/projects/p1/tool:missing', 'linux/amd64', access)).rejects.toThrow('不存在');
  f.objects.set(`/v2/runtime/projects/p1/tool/manifests/${f.manifest}`, '{"schemaVersion":2}');
  await expect(f.registry.inspect(`runtime/projects/p1/tool@${f.manifest}`, 'linux/amd64', access)).rejects.toThrow('摘要不匹配');
  const badConfig = f.add('blobs', { os: 'linux', architecture: 'amd64', rootfs: { type: 'layers', diff_ids: [] }, config: {} });
  const incomplete = f.add('manifests', { schemaVersion: 2, config: { digest: badConfig, mediaType: 'config', size: 1 }, layers: [{ digest: layer, mediaType: 'layer', size: 1 }] });
  await expect(f.registry.inspect(`runtime/projects/p1/tool@${incomplete}`, 'linux/amd64', access)).rejects.toThrow('元数据不完整');
});
test('网络故障、仓库错误、虚假摘要头与超大响应明确失败', async () => {
  const check = async (response: () => Response) => httpRuntimeImageRegistry(layout, (async () => response()) as unknown as typeof fetch).inspect('runtime/projects/p1/tool:v1', 'linux/amd64', access);
  await expect(check(() => { throw new Error('offline'); })).rejects.toThrow('不可达');
  await expect(check(() => new Response('', { status: 503 }))).rejects.toThrow('503');
  await expect(check(() => new Response('{}', { headers: { 'Docker-Content-Digest': layer } }))).rejects.toThrow('摘要不匹配');
  await expect(check(() => new Response('{}', { headers: { 'Content-Length': '4194305' } }))).rejects.toThrow('大小限制');
  await expect(check(() => new Response('x'.repeat(4194305)))).rejects.toThrow('大小限制');
});
