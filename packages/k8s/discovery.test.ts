import { expect, test } from 'bun:test';
import { discoverNamespaced } from './discovery';

test('discovery 包含自定义资源、使用首选版本与真实复数名，排除集群级和子资源', async () => {
  const pages: Record<string, unknown> = {
    '/api': { versions: ['v1'] }, '/apis': { groups: [{ preferredVersion: { groupVersion: 'example.io/v2' }, versions: [{ groupVersion: 'example.io/v2' }, { groupVersion: 'example.io/v1' }] }] },
    '/api/v1': { resources: [{ name: 'pods', kind: 'Pod', namespaced: true, verbs: ['list'] }, { name: 'pods/log', kind: 'Pod', namespaced: true, verbs: ['list'] }, { name: 'nodes', kind: 'Node', namespaced: false, verbs: ['list'] }] },
    '/apis/example.io/v2': { resources: [{ name: 'mice', kind: 'Mouse', namespaced: true, verbs: ['list'] }, { name: 'bindings', kind: 'Binding', namespaced: true, verbs: ['create'] }] },
    '/apis/example.io/v1': { resources: [{ name: 'mice', kind: 'Mouse', namespaced: true, verbs: ['list'] }, { name: 'legacy', kind: 'Legacy', namespaced: true, verbs: ['list'] }] },
  };
  expect(await discoverNamespaced(async (path) => pages[path])).toEqual([{ apiVersion: 'v1', kind: 'Pod', plural: 'pods', namespaced: true }, { apiVersion: 'example.io/v2', kind: 'Mouse', plural: 'mice', namespaced: true }, { apiVersion: 'example.io/v1', kind: 'Legacy', plural: 'legacy', namespaced: true }]);
  for (const path of ['/api', '/apis', '/api/v1']) {
    await expect(discoverNamespaced(async (key) => key === path ? {} : pages[key])).rejects.toThrow('不完整');
  }
  await expect(discoverNamespaced(async (key) => key === '/apis' ? { groups: [{}] } : pages[key])).rejects.toThrow('首选版本');
  await expect(discoverNamespaced(async () => { throw new Error('permission denied'); })).rejects.toThrow('permission denied');
});
