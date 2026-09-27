import { expect, test } from 'bun:test';
import { inspectSourceLink, inspectSourceTree } from './sourceTree';

const file = (path: string, mode = '100644') => ({ path, mode, type: 'blob' as const });
test('嵌套上下文只读取对应 Dockerfile，允许上下文内链接，拒绝越界链接', () => {
  const tree = [file('Dockerfile'), file('tools/Dockerfile'), file('tools/link', '120000'), file('.gitattributes')];
  expect(inspectSourceTree(tree, 'tools', 'Dockerfile')).toMatchObject({ dockerfilePath: 'tools/Dockerfile', links: [file('tools/link', '120000')], attributes: [file('.gitattributes')] });
  expect(() => inspectSourceLink('tools/bin/tool', '../actual/tool', 'tools')).not.toThrow();
  for (const target of ['../../outside', '/etc/passwd', '../..', 'file\nother', 'file\\other']) expect(() => inspectSourceLink('tools/link', target, 'tools')).toThrow('之外');
});
test('Dockerfile 符号链接、上下文经链接、子模块和缺文件均拒绝', () => {
  expect(() => inspectSourceTree([file('Dockerfile', '120000')], '.', 'Dockerfile')).toThrow('常规文件');
  expect(() => inspectSourceTree([file('alias', '120000'), file('alias/tools/Dockerfile')], 'alias/tools', 'Dockerfile')).toThrow('穿过');
  expect(() => inspectSourceTree([file('Dockerfile'), { path: 'sub', type: 'commit', mode: '160000' }], '.', 'Dockerfile')).toThrow('子模块');
  expect(() => inspectSourceTree([file('Dockerfile'), file('.gitmodules')], '.', 'Dockerfile')).toThrow('子模块');
  expect(() => inspectSourceTree([], '.', 'Dockerfile')).toThrow('常规文件');
});
