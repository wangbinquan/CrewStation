import { describe, expect, test } from 'bun:test';
import { createClaudeCodeCliDriver, createOpencodeCliDriver } from './cliDriver';
import { createDriverRegistry } from './registry';
import { createStubDriver } from './stubDriver';

describe('CLI 驱动接线', () => {
  test('二进制缺失时不宣告可用；存在时宣告可用', () => {
    expect(createClaudeCodeCliDriver({ which: () => null }).available()).toBe(false);
    expect(createClaudeCodeCliDriver({ which: () => '/usr/local/bin/claude' }).available()).toBe(true);
    expect(createOpencodeCliDriver({ which: () => null }).available()).toBe(false);
    expect(createOpencodeCliDriver({ which: () => '/usr/local/bin/opencode' }).available()).toBe(true);
  });

  test('驱动名与契约一致', () => {
    expect(createClaudeCodeCliDriver({ which: () => null }).name).toBe('claude-code');
    expect(createOpencodeCliDriver({ which: () => null }).name).toBe('opencode');
  });
});

describe('驱动注册表', () => {
  test('内建三种驱动；available 只含二进制在位的驱动；重复注册报错', () => {
    const drivers = [createStubDriver(), createClaudeCodeCliDriver({ which: () => null }), createOpencodeCliDriver({ which: () => '/bin/opencode' })];
    const registry = createDriverRegistry(drivers);
    expect(registry.names().sort()).toEqual(['claude-code', 'opencode', 'stub']);
    expect(registry.available().sort()).toEqual(['opencode', 'stub']);
    expect(registry.get('stub')?.name).toBe('stub');
    const stub = registry.get('stub');
    expect(() => createDriverRegistry([stub!, stub!])).toThrow(/重复注册/);
  });
});
