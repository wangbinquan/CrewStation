import { describe, expect, test } from 'bun:test';
import { OPERATIONS, PROXY_NAME, operationKey } from './catalog';

/** 目录只认发布时从 openapi.yaml 读出的操作，所以两份清单必须一致。 */
async function openApiOperations(): Promise<{ method: string; path: string }[]> {
  const doc = Bun.YAML.parse(await Bun.file(new URL('../../openapi.yaml', import.meta.url)).text()) as {
    paths: Record<string, Record<string, unknown>>;
  };
  const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const out: { method: string; path: string }[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of methods) {
      if (item[method] !== undefined) out.push({ method: method.toUpperCase(), path });
    }
  }
  return out;
}

const sortKeys = (items: { method: string; path: string }[]): string[] =>
  items.map((op) => `${op.method} ${op.path}`).sort();

describe('目录操作清单', () => {
  test('与 openapi.yaml 的 paths 逐条一致：改一处必须改另一处', async () => {
    expect(sortKeys(await openApiOperations())).toEqual(sortKeys([...OPERATIONS]));
  });

  test('刻意只覆盖项目、分支、标签、提交这一小片', () => {
    expect(OPERATIONS.length).toBeLessThanOrEqual(10);
    for (const op of OPERATIONS) expect(op.path.startsWith('/v4/projects')).toBe(true);
    expect(OPERATIONS.filter((op) => op.method !== 'GET')).toEqual([{ method: 'POST', path: '/v4/projects/{id}/repository/branches' }]);
  });

  test('操作键就是平台的 `<proxy>:<METHOD>:<path>`', () => {
    expect(operationKey('get', '/v4/projects')).toBe('test-gitlab:GET:/v4/projects');
    expect(PROXY_NAME).toBe('test-gitlab');
    // 代理名必须合平台 slug（packages/contracts/ids.ts 的 SlugSchema）。
    expect(PROXY_NAME).toMatch(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/);
  });

  test('与 crewstation.yaml 的 spec.proxy 一致', async () => {
    const manifest = Bun.YAML.parse(await Bun.file(new URL('../../crewstation.yaml', import.meta.url)).text()) as {
      kind: string; spec: { proxy: string; apis: { exposes: { openapi: string } } };
    };
    expect(manifest.kind).toBe('APIProxy');
    expect(manifest.spec.proxy).toBe(PROXY_NAME);
    expect(manifest.spec.apis.exposes.openapi).toBe('./openapi.yaml');
  });
});
