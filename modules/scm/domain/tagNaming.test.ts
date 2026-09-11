import { describe, expect, test } from 'bun:test';
import { compareReleaseVersions, latestReleaseTag, nextTag, parseReleaseTag } from './tagNaming';

describe('tagNaming', () => {
  test('只接受 v<major>.<minor>.<patch>，不接受前导零、预发布后缀或缺少 v', () => {
    expect(parseReleaseTag('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseReleaseTag('v0.0.0')).toEqual({ major: 0, minor: 0, patch: 0 });
    for (const bad of ['1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-rc1', 'release-1', 'v1.2.3.4']) expect(parseReleaseTag(bad)).toBeUndefined();
  });

  test('最新标签按数值比较而不是字典序，手工标签被忽略', () => {
    expect(latestReleaseTag(['v1.9.0', 'v1.10.0', 'v0.99.99', 'hotfix', 'v1.10.0-rc'])).toBe('v1.10.0');
    expect(latestReleaseTag(['manual', 'other'])).toBeUndefined();
    expect(compareReleaseVersions({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 99, patch: 99 })).toBeGreaterThan(0);
  });

  test('bump 从最新标签递增，无标签从 v0.0.0 起算；显式标签原样返回', () => {
    expect(nextTag(undefined, 'patch')).toBe('v0.0.1');
    expect(nextTag(undefined, 'minor')).toBe('v0.1.0');
    expect(nextTag(undefined, 'major')).toBe('v1.0.0');
    expect(nextTag('v1.2.3', 'patch')).toBe('v1.2.4');
    expect(nextTag('v1.2.3', 'minor')).toBe('v1.3.0');
    expect(nextTag('v1.2.3', 'major')).toBe('v2.0.0');
    expect(nextTag('v1.2.3', 'v9.0.0')).toBe('v9.0.0');
    expect(() => nextTag('v1.2.3', 'v9')).toThrow(expect.objectContaining({ kind: 'validation' }));
    expect(() => nextTag('weird', 'patch')).toThrow(expect.objectContaining({ kind: 'validation' }));
  });
});
