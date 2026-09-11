import { describe, expect, test } from 'bun:test';
import { isPlatformError } from '@crewstation/kernel';
import type { McpServerSpec } from '../contract/spawnPlan';
import { toMcpServerSpec } from '../contract/spawnPlan';
import {
  partitionMcpsForInjection,
  renderClaudeMcpInjection,
  renderClaudeMcpServerEntry,
  renderOpencodeMcpEntry,
  renderOpencodeMcpInjection,
} from '../injection/mcpInjection';

const remote = (name: string, url = 'https://mcp.example/svc'): McpServerSpec => ({ name, enabled: true, type: 'remote', url, headers: { Authorization: 'Bearer x' } });
const local = (name: string): McpServerSpec => ({ name, enabled: true, type: 'local', command: ['bun', 'run', 'server.ts'], env: { K: 'V' }, timeoutMs: 30_000 });

describe('McpConnection → 注入形状', () => {
  test('协议里的 McpConnection 只有 Streamable HTTP 一种，转成 remote', () => {
    expect(toMcpServerSpec({ name: 'cs-ops', url: 'https://mcp.example/ops', headers: { A: 'b' } }))
      .toEqual({ name: 'cs-ops', enabled: true, type: 'remote', url: 'https://mcp.example/ops', headers: { A: 'b' } });
  });

  test('空 headers 不渲染成空对象', () => {
    expect(toMcpServerSpec({ name: 'cs-ops', url: 'https://mcp.example/ops', headers: {} }).type).toBe('remote');
    expect('headers' in toMcpServerSpec({ name: 'cs-ops', url: 'https://mcp.example/ops', headers: {} })).toBe(false);
  });
});

describe('分拣', () => {
  test('enabled: false 跳过并单独记名', () => {
    const result = partitionMcpsForInjection([{ ...remote('a'), enabled: false }, remote('b')]);
    expect(result.injected.map((m) => m.name)).toEqual(['b']);
    expect(result.skippedDisabled).toEqual(['a']);
  });

  test('同名同目标去重，first-seen 顺序保留', () => {
    const result = partitionMcpsForInjection([remote('a'), remote('b'), remote('a')]);
    expect(result.injected.map((m) => m.name)).toEqual(['a', 'b']);
  });

  test('同名异目标拒绝拉起（绝不静默替换成另一个服务）', () => {
    let caught: unknown;
    try {
      partitionMcpsForInjection([remote('a', 'https://one.example'), remote('a', 'https://two.example')]);
    } catch (error) {
      caught = error;
    }
    expect(isPlatformError(caught)).toBe(true);
    expect((caught as Error).message).toContain("'a'");
  });

  test("MCP 名可以是 constructor 这类原型键", () => {
    expect(partitionMcpsForInjection([remote('constructor')]).injected).toHaveLength(1);
  });
});

describe('wire 形状', () => {
  test('opencode：env → environment、timeoutMs → timeout、不发 cwd', () => {
    expect(renderOpencodeMcpEntry(local('a'))).toEqual({
      type: 'local', enabled: true, command: ['bun', 'run', 'server.ts'], environment: { K: 'V' }, timeout: 30_000,
    });
    expect(renderOpencodeMcpEntry(remote('b'))).toEqual({
      type: 'remote', enabled: true, url: 'https://mcp.example/svc', headers: { Authorization: 'Bearer x' },
    });
  });

  test('claude：local 拆成 command ＋ args；remote 是 type http；timeout 不渲染', () => {
    expect(renderClaudeMcpServerEntry(local('a'))).toEqual({ command: 'bun', args: ['run', 'server.ts'], env: { K: 'V' } });
    expect(renderClaudeMcpServerEntry(remote('b'))).toEqual({ type: 'http', url: 'https://mcp.example/svc', headers: { Authorization: 'Bearer x' } });
  });

  test('没有启用条目时整体为 null（调用方据此省略 --mcp-config ／ mcp 键）', () => {
    expect(renderClaudeMcpInjection([]).entries).toBeNull();
    expect(renderOpencodeMcpInjection([{ ...remote('a'), enabled: false }]).entries).toBeNull();
  });
});
