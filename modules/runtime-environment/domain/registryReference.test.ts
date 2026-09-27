import { expect, test } from 'bun:test';
import { parseRuntimeImageReference } from './registryReference';
import { verifyImageLineage } from './imageLineage';

const layout = { pullBase: 'registry.internal:5000', pushHost: 'registry.test', scheme: 'http' as const };
const access = { prefixes: ['runtime/projects/p1/'], exact: ['crewstation/task'] };
test('只允许平台仓库和受权项目精确前缀，固定引用不能混入 URL 或额外摘要', () => {
  expect(parseRuntimeImageReference('registry.test/runtime/projects/p1/tools:v1', layout, access)).toEqual({ repository: 'runtime/projects/p1/tools', reference: 'v1' });
  expect(parseRuntimeImageReference('crewstation/task@sha256:' + 'a'.repeat(64), layout, access).reference).toBe('sha256:' + 'a'.repeat(64));
  for (const ref of ['evil.test/runtime/projects/p1/tools:v1', 'runtime/projects/p11/tools:v1', 'runtime/projects/p1/tools', 'runtime/projects/p1/tool:v1?key=x', 'https://registry.test/runtime/projects/p1/tool:v1', 'runtime/projects/p1/tool%2F:v1', 'runtime/projects/p1/tool@sha256:' + 'a'.repeat(64) + '@other']) expect(() => parseRuntimeImageReference(ref, layout, access)).toThrow();
});
test('产物必须保留完整且按序的基础层，标签或相同层数不能替代谱系证明', () => {
  expect(() => verifyImageLineage(['a', 'b'], ['a', 'b', 'c'])).not.toThrow();
  expect(() => verifyImageLineage(['a', 'b'], ['b', 'a'])).toThrow('基础层');
  expect(() => verifyImageLineage(['a', 'b'], ['a'])).toThrow('基础层');
  expect(() => verifyImageLineage([], ['a'])).toThrow('基础层');
});
