import { expect, test } from 'bun:test';
import { configuredImageResolver, serviceImageResolver } from './serviceImage';

const layout = { pullBase: 'registry.internal:5000', pushHost: 'registry.test', scheme: 'http' as const };
const sha = (content: string) => `sha256:${new Bun.CryptoHasher('sha256').update(content).digest('hex')}`;
const digest = `sha256:${'a'.repeat(64)}`;
test('服务产物按仓库实际字节固定摘要，兼容单镜像和平台已有索引策略', async () => {
  const values = [
    { schemaVersion: 2, config: { digest, mediaType: 'application/vnd.oci.image.config.v1+json', size: 1 }, layers: [] },
    { schemaVersion: 2, manifests: [{ digest, mediaType: 'application/vnd.oci.image.manifest.v1+json', size: 1, platform: { os: 'linux', architecture: 'amd64' } }] },
  ];
  for (const value of values) {
    const body = JSON.stringify(value), calls: string[] = [];
    const resolve = serviceImageResolver(layout, (async (url, init) => { calls.push(String(url)); expect(init?.redirect).toBe('error'); return new Response(body); }) as typeof fetch);
    expect(await resolve('demo', 'registry.internal:5000/demo:v1')).toBe(`registry.internal:5000/demo@${sha(body)}`);
    expect(calls[0]).toBe('http://registry.internal:5000/v2/demo/manifests/v1');
  }
});
test('服务构建不能固定外项目仓库、不合法清单或虚假的摘要', async () => {
  let calls = 0;
  const resolve = serviceImageResolver(layout, (async () => { calls++; return new Response('{}'); }) as unknown as typeof fetch);
  await expect(resolve('demo', 'registry.internal:5000/other:v1')).rejects.toThrow(); expect(calls).toBe(0);
  await expect(resolve('demo', 'registry.internal:5000/demo:v1')).rejects.toThrow('有效镜像清单');
  await expect(resolve('demo', `registry.internal:5000/demo@${digest}`)).rejects.toThrow('摘要不匹配');
});

test('平台默认任务镜像固定内容摘要，外仓库或 tag 后移不能替换已解析内容', async () => {
  const body = JSON.stringify({ schemaVersion: 2, config: { digest, mediaType: 'application/vnd.oci.image.config.v1+json', size: 1 }, layers: [] });
  const calls: string[] = [];
  const resolve = configuredImageResolver(layout, (async (url) => { calls.push(String(url)); return new Response(body); }) as typeof fetch);
  await expect(resolve('external.test/task:v1')).rejects.toThrow('受管仓库'); expect(calls).toHaveLength(0);
  const pinned = await resolve(`${layout.pullBase}/crewstation/task:v1`);
  expect(pinned).toBe(`${layout.pullBase}/crewstation/task@${sha(body)}`);
  expect(await resolve(pinned)).toBe(pinned); expect(decodeURIComponent(calls.at(-1)!)).toEndWith(`/manifests/${sha(body)}`);
});
