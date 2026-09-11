import { describe, expect, test } from 'bun:test';
import { compareSemver, extractVersion } from '../process/semver';
import { OPENCODE_AUTO_FLAG_RENAME_VERSION, resolveAutoApproveFlag } from '../drivers/opencode/argv';

describe('semver', () => {
  test('从任意输出里取第一个 X.Y.Z', () => {
    expect(extractVersion('2.1.268 (Claude Code)')).toBe('2.1.268');
    expect(extractVersion('opencode\n1.18.29\n')).toBe('1.18.29');
    expect(extractVersion('v10.2.3-beta.4')).toBe('10.2.3');
    expect(extractVersion('no version here')).toBeNull();
  });

  test('只比较 major.minor.patch；不可解析时返回 0（相等）', () => {
    expect(compareSemver('1.18.0', '1.18.0')).toBe(0);
    expect(compareSemver('1.17.9', '1.18.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.18.0-rc1', '1.18.0')).toBe(0);
    expect(compareSemver('garbage', '1.0.0')).toBe(0);
  });
});

describe('opencode auto-approve flag 的版本门', () => {
  test('未知／不可解析版本默认用当前拼写 --auto', () => {
    expect(resolveAutoApproveFlag(undefined)).toBe('--auto');
    expect(resolveAutoApproveFlag(null)).toBe('--auto');
    expect(resolveAutoApproveFlag('nightly-build')).toBe('--auto');
  });

  test(`>= ${OPENCODE_AUTO_FLAG_RENAME_VERSION} 用 --auto，明确更低才用旧拼写`, () => {
    expect(resolveAutoApproveFlag('1.18.0')).toBe('--auto');
    expect(resolveAutoApproveFlag('1.18.29')).toBe('--auto');
    expect(resolveAutoApproveFlag('2.0.0')).toBe('--auto');
    expect(resolveAutoApproveFlag('1.17.9')).toBe('--dangerously-skip-permissions');
    expect(resolveAutoApproveFlag('0.9.0')).toBe('--dangerously-skip-permissions');
  });
});
