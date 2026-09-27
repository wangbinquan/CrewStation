import { expect, test } from 'bun:test';
import { resourcesMatch } from './quantities';

test('资源数量按值比较、字段不能增加或遗漏，非法单位不接纳', () => {
  const compare = (actual: string, expected: string) => resourcesMatch({ requests: { cpu: actual }, limits: { cpu: actual } }, { cpu: expected });
  expect(compare('1000m', '1')).toBe(true);
  expect(compare('1024Mi', '1Gi')).toBe(true);
  expect(compare('1e3', '1k')).toBe(true);
  expect(compare('.1', '100m')).toBe(true);
  expect(compare('10', '10')).toBe(true);
  for (const value of ['invalid', '1e31', '0.1234567890123456789012345678901', '2']) expect(compare(value, '1')).toBe(false);
  expect(resourcesMatch(undefined, { cpu: '1' })).toBe(false);
  expect(resourcesMatch({ requests: { cpu: '1', memory: '1' }, limits: { cpu: '1' } }, { cpu: '1' })).toBe(false);
});
