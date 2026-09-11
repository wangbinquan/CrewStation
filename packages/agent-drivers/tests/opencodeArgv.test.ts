import { describe, expect, test } from 'bun:test';
import { isPlatformError } from '@crewstation/kernel';
import type { AgentSpawnContext } from '../contract/spawnPlan';
import { toMcpServerSpec } from '../contract/spawnPlan';
import { MAX_OPENCODE_PROMPT_BYTES, OPENCODE_AGENT_NAME, buildOpencodeArgv } from '../drivers/opencode/argv';
import { OPENCODE_CONFIG_DIR_ENV, buildOpencodeEnv } from '../drivers/opencode/env';
import { buildOpencodeInlineConfig } from '../drivers/opencode/inlineConfig';

function ctx(overrides: Partial<AgentSpawnContext> = {}): AgentSpawnContext {
  return {
    agentId: 'agt-1',
    prompt: '你好',
    systemPrompt: 'you are a worker',
    model: 'anthropic/claude-sonnet-4',
    permission: 'edit',
    mcps: [],
    cwd: '/work',
    runDir: '/tmp/run',
    baseEnv: { PATH: '/usr/bin', OPENCODE_PERMISSION: '{"bash":"allow"}' },
    ...overrides,
  };
}

describe('OpenCode argv', () => {
  test('形状固定，prompt 作为 -- 之后的尾随位置参数', () => {
    expect(buildOpencodeArgv({ binaryVersion: '1.18.29' }, '第一行以 - 开头')).toEqual([
      'opencode', 'run', '--agent', OPENCODE_AGENT_NAME, '--format', 'json', '--thinking', '--auto', '--', '第一行以 - 开头',
    ]);
  });

  test('auto-approve flag 无条件出现；旧版本用旧拼写', () => {
    expect(buildOpencodeArgv({ binaryVersion: '1.17.0' }, 'hi')).toContain('--dangerously-skip-permissions');
    expect(buildOpencodeArgv({ binaryVersion: null }, 'hi')).toContain('--auto');
  });

  test('--session 紧跟 auto flag 之后、-- 之前', () => {
    const argv = buildOpencodeArgv({ binaryVersion: '1.18.29', resumeSessionId: 'ses_1' }, 'hi');
    expect(argv.slice(7)).toEqual(['--auto', '--session', 'ses_1', '--', 'hi']);
  });

  test('prompt 超过 argv 上限时可读地失败（kernel validation）', () => {
    const huge = 'x'.repeat(MAX_OPENCODE_PROMPT_BYTES + 1);
    let caught: unknown;
    try {
      buildOpencodeArgv({}, huge);
    } catch (error) {
      caught = error;
    }
    expect(isPlatformError(caught)).toBe(true);
    expect((caught as Error).message).toContain('argv 上限');
  });

  test('上限量的是字节而不是码元', () => {
    const cjk = '中'.repeat(Math.ceil(MAX_OPENCODE_PROMPT_BYTES / 3) + 1);
    expect(cjk.length).toBeLessThan(MAX_OPENCODE_PROMPT_BYTES);
    expect(() => buildOpencodeArgv({}, cjk)).toThrow();
  });
});

describe('OpenCode env', () => {
  test('钉 PWD、设配置目录、剔除 OPENCODE_PERMISSION', () => {
    const { env } = buildOpencodeEnv(ctx(), '/tmp/run/.opencode');
    expect(env.PWD).toBe('/work');
    expect(env[OPENCODE_CONFIG_DIR_ENV]).toBe('/tmp/run/.opencode');
    expect(env.OPENCODE_PERMISSION).toBeUndefined();
    expect(env.OPENCODE_CONFIG_CONTENT).toBeDefined();
  });

  test('不设置清单插件的输出路径（该面不复制）', () => {
    expect(buildOpencodeEnv(ctx(), '/tmp/run/.opencode').env.OPENCODE_AW_INVENTORY_OUT).toBeUndefined();
  });
});

describe('OpenCode 内联配置', () => {
  test('单个 agent 条目，带 prompt、permission 与 model', () => {
    const config = buildOpencodeInlineConfig(ctx());
    const entry = config.agent[OPENCODE_AGENT_NAME];
    expect(entry?.prompt).toBe('you are a worker');
    expect(entry?.model).toBe('anthropic/claude-sonnet-4');
    expect((entry?.permission as Record<string, string>).edit).toBe('allow');
    expect((entry?.permission as Record<string, string>).bash).toBe('deny');
    expect(config.mcp).toBeUndefined();
  });

  test('model 为空时整键省略（让 opencode 用自己的默认）', () => {
    expect(buildOpencodeInlineConfig(ctx({ model: '' })).agent[OPENCODE_AGENT_NAME]?.model).toBeUndefined();
  });

  test('MCP 渲染成 remote 条目，timeoutMs 改名为 timeout', () => {
    const config = buildOpencodeInlineConfig(ctx({
      mcps: [{ ...toMcpServerSpec({ name: 'cs-ops', url: 'https://mcp.example/svc', headers: {} }), timeoutMs: 30_000 }],
    }));
    expect(config.mcp?.['cs-ops']).toEqual({ type: 'remote', enabled: true, url: 'https://mcp.example/svc', timeout: 30_000 });
  });
});
