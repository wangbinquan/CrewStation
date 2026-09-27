import { expect, test } from 'bun:test';
import { RuntimeImageSourceSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { runtimeImageSourcePreparation } from '../application/sourcePreparation';
import { actor, digest } from './runtimeImageFixture';

test('按受理 SHA 读取 Dockerfile 和链接，tag 移动不影响修订内容，Agent 明确选底座', async () => {
  const reads: string[] = [], sha = 'b'.repeat(40);
  const preparer = runtimeImageSourcePreparation({
    resolve: async () => ({ commitSha: sha, tree: [{ path: 'Dockerfile', type: 'blob', mode: '100644' }] }),
    readFile: async (_binding, commit, path) => { reads.push(`${commit}/${path}`); return 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}\nRUN pip install requests'; },
  }, { resolve: async () => `registry.test/base@${digest}` }, { resolve: async () => `registry.test/existing@${digest}` });
  const source = RuntimeImageSourceSchema.parse({ kind: 'source', repositoryBindingId: newResourceId(), ref: 'main', architecture: 'linux/amd64', usage: 'task' });
  expect(await preparer.prepare(actor(), newResourceId(), source)).toMatchObject({ commitSha: sha, baseImage: `registry.test/base@${digest}` });
  expect(reads).toEqual([`${sha}/Dockerfile`]);
  await expect(preparer.prepare(actor(), newResourceId(), { ...source, usage: 'agent' })).rejects.toThrow('固定算力档位');
  expect(await preparer.prepare(actor(), newResourceId(), RuntimeImageSourceSchema.parse({ kind: 'existing', reference: 'registry.test/existing:v1', architecture: 'linux/amd64', usage: 'service' }))).toMatchObject({ source: { reference: `registry.test/existing@${digest}` } });
});
test('LFS、越界链接与未固定底座拒绝，不静默漏入源码', async () => {
  let mode: 'lfs' | 'link' | 'base' = 'lfs';
  const preparer = runtimeImageSourcePreparation({
    resolve: async () => ({ commitSha: 'b'.repeat(40), tree: [{ path: 'Dockerfile', type: 'blob', mode: '100644' }, { path: '.gitattributes', type: 'blob', mode: '100644' }, ...(mode === 'link' ? [{ path: 'bad', type: 'blob' as const, mode: '120000' }] : [])] }),
    readFile: async (_binding, _sha, path) => path === '.gitattributes' ? (mode === 'lfs' ? '*.bin filter=lfs' : '') : path === 'bad' ? '../outside' : 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}',
  }, { resolve: async () => 'registry.test/base:latest' }, { resolve: async () => '' });
  const source = RuntimeImageSourceSchema.parse({ kind: 'source', repositoryBindingId: newResourceId(), ref: 'main', architecture: 'linux/amd64', usage: 'task' });
  await expect(preparer.prepare(actor(), newResourceId(), source)).rejects.toThrow('LFS');
  mode = 'link'; await expect(preparer.prepare(actor(), newResourceId(), source)).rejects.toThrow('之外');
  mode = 'base'; await expect(preparer.prepare(actor(), newResourceId(), source)).rejects.toThrow('未固定摘要');
});
