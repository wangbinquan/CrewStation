import { expect, test } from 'bun:test';
import { selectRuntimeImage } from './selection';

test('显式选择优先，缺省用当前位置默认，不从其他容器隐式继承', () => {
  expect(selectRuntimeImage('optional', { runtimeImageVersionId: 'default', allowedRuntimeImageVersionIds: ['optional'] })).toEqual({ versionId: 'optional', source: 'request' });
  expect(selectRuntimeImage(undefined, { runtimeImageVersionId: 'default' })).toEqual({ versionId: 'default', source: 'configuration' });
  expect(selectRuntimeImage(undefined, {})).toBeUndefined();
  expect(selectRuntimeImage('default', { runtimeImageVersionId: 'default' })).toEqual({ versionId: 'default', source: 'request' });
});
test('选了未授权版本不能回退，允许列表本身不变成默认选择', () => {
  expect(() => selectRuntimeImage('foreign', { runtimeImageVersionId: 'default' })).toThrow('不在此执行位置');
  expect(() => selectRuntimeImage('foreign', {})).toThrow('不在此执行位置');
  expect(selectRuntimeImage(undefined, { allowedRuntimeImageVersionIds: ['optional'] })).toBeUndefined();
});
