import { describe, expect, test } from 'bun:test';
import { isPlatformError } from '@crewstation/kernel';
import type { AgentSpawnContext } from '../contract/spawnPlan';
import { toMcpServerSpec } from '../contract/spawnPlan';
import { MAX_OPENCODE_PROMPT_BYTES, OPENCODE_AGENT_NAME, buildOpencodeArgv } from '../drivers/opencode/argv';
import { OPENCODE_CONFIG_DIR_ENV, buildOpencodeEnv, opencodeConfigDirName } from '../drivers/opencode/env';
import { buildOpencodeInlineConfig } from '../drivers/opencode/inlineConfig';
import { buildOpencodeNativeEnv } from '../drivers/opencode/nativeEnv';
import { buildOpencodeNativeArgv } from '../drivers/opencode/nativeArgv';

const HEAD = ['/usr/local/bin/opencode'];

function ctx(overrides: Partial<AgentSpawnContext> = {}): AgentSpawnContext {
  return {
    agentId: 'agt-1',
    head: HEAD,
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
    expect(buildOpencodeArgv({ head: HEAD, binaryVersion: '1.18.29' }, '第一行以 - 开头')).toEqual([
      '/usr/local/bin/opencode', 'run', '--agent', OPENCODE_AGENT_NAME, '--format', 'json', '--thinking', '--auto', '--', '第一行以 - 开头',
    ]);
  });

  test('auto-approve flag 无条件出现；旧版本用旧拼写', () => {
    expect(buildOpencodeArgv({ head: HEAD, binaryVersion: '1.17.0' }, 'hi')).toContain('--dangerously-skip-permissions');
    expect(buildOpencodeArgv({ head: HEAD, binaryVersion: null }, 'hi')).toContain('--auto');
  });

  test('--session 紧跟 auto flag 之后、-- 之前', () => {
    const argv = buildOpencodeArgv({ head: HEAD, binaryVersion: '1.18.29', resumeSessionId: 'ses_1' }, 'hi');
    expect(argv.slice(7)).toEqual(['--auto', '--session', 'ses_1', '--', 'hi']);
  });

  test('prompt 超过 argv 上限时可读地失败（kernel validation）', () => {
    const huge = 'x'.repeat(MAX_OPENCODE_PROMPT_BYTES + 1);
    let caught: unknown;
    try {
      buildOpencodeArgv({ head: HEAD }, huge);
    } catch (error) {
      caught = error;
    }
    expect(isPlatformError(caught)).toBe(true);
    expect((caught as Error).message).toContain('argv 上限');
  });

  test('上限量的是字节而不是码元', () => {
    const cjk = '中'.repeat(Math.ceil(MAX_OPENCODE_PROMPT_BYTES / 3) + 1);
    expect(cjk.length).toBeLessThan(MAX_OPENCODE_PROMPT_BYTES);
    expect(() => buildOpencodeArgv({ head: HEAD }, cjk)).toThrow();
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

  test('fork 改名的配置目录变量名与目录叶名（RFC-006）；与平台注入的变量同名即拒绝', () => {
    const fork = ctx({ configDir: { env: 'FORK_CONFIG_DIR', name: '.fork' } });
    expect(opencodeConfigDirName(fork)).toBe('.fork');
    const { env } = buildOpencodeEnv(fork, '/tmp/run/.fork');
    expect(env.FORK_CONFIG_DIR).toBe('/tmp/run/.fork');
    expect(env[OPENCODE_CONFIG_DIR_ENV]).toBeUndefined();
    expect(opencodeConfigDirName(ctx())).toBe('.opencode');
    for (const name of ['OPENCODE_CONFIG_CONTENT', 'PWD', 'CS_RUNNER_TOKEN', 'GIT_AUTHOR_NAME']) expect(() => buildOpencodeEnv(ctx({ configDir: { env: name } }), '/tmp/run/x')).toThrow(name);
  });

  test('原生 TUI：档位没有模型时（P2）不锁定 model／providers／whitelist，argv 也不带 --model', () => {
    const { model: _omit, ...noModel } = ctx();
    const env = buildOpencodeNativeEnv(noModel, '/tmp/run/.opencode');
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!) as Record<string, unknown>;
    expect(config.model).toBeUndefined();
    expect(config.enabled_providers).toBeUndefined();
    expect(config.provider).toBeUndefined();
    expect(buildOpencodeNativeArgv(noModel)).toEqual(['/usr/local/bin/opencode', '--agent', OPENCODE_AGENT_NAME]);
    const pinned = JSON.parse(buildOpencodeNativeEnv(ctx(), '/tmp/run/.opencode').OPENCODE_CONFIG_CONTENT!) as Record<string, unknown>;
    expect(pinned).toMatchObject({ model: 'anthropic/claude-sonnet-4', enabled_providers: ['anthropic'] });
    expect(() => buildOpencodeNativeEnv(ctx({ model: 'no-provider' }), '/tmp/run/.opencode')).toThrow('provider/model');
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

  test('opencode 生成参数写进 agent 条目（与 agent-workflow 一致）；未设置的键不出现', () => {
    const entry = buildOpencodeInlineConfig(ctx({ opencode: { variant: 'high', temperature: 0.2, steps: 30, maxSteps: 60 } })).agent[OPENCODE_AGENT_NAME];
    expect(entry).toMatchObject({ variant: 'high', temperature: 0.2, steps: 30, maxSteps: 60 });
    const partial = buildOpencodeInlineConfig(ctx({ opencode: { temperature: 0 } })).agent[OPENCODE_AGENT_NAME];
    expect(partial?.temperature).toBe(0);
    expect(partial && 'variant' in partial).toBe(false);
    expect(partial && 'steps' in partial).toBe(false);
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
