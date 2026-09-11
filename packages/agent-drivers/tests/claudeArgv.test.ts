import { describe, expect, test } from 'bun:test';
import type { AgentSpawnContext } from '../contract/spawnPlan';
import { toMcpServerSpec } from '../contract/spawnPlan';
import {
  CLAUDE_HEADLESS_BASE_ARGV,
  CLAUDE_PLATFORM_OWNED_FLAGS,
  CLAUDE_STREAM_INPUT_ARGV,
  buildClaudeArgv,
  buildClaudeSpawn,
  claudeModelName,
  renderClaudeMcpConfig,
} from '../drivers/claudeCode/argv';
import { assembleClaudeEnv } from '../drivers/claudeCode/env';
import { claudeUserMessageFrame } from '../drivers/claudeCode/streamInput';

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
    baseEnv: { PATH: '/usr/bin', HOME: '/work' },
    ...overrides,
  };
}

const files = { systemPromptFile: '/tmp/run/system.md', mcpServerNames: [] as string[] };

describe('Claude argv', () => {
  test('headless 传输基线在命令头之后，顺序固定', () => {
    const argv = buildClaudeArgv({ ctx: ctx(), ...files });
    expect(argv.slice(0, 5)).toEqual(['claude', ...CLAUDE_HEADLESS_BASE_ARGV]);
  });

  test('三档权限恒走 dontAsk ＋ 显式 --tools，不落到 bypassPermissions', () => {
    const argv = buildClaudeArgv({ ctx: ctx({ permission: 'read-only' }), ...files });
    expect(argv).toContain('--permission-mode');
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(argv[argv.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,WebFetch,WebSearch');
    expect(argv).not.toContain('bypassPermissions');
  });

  test('model 剥掉 <provider>/ 前缀；没有 model 时整段省略', () => {
    expect(claudeModelName('anthropic/claude-sonnet-4')).toBe('claude-sonnet-4');
    expect(claudeModelName('fable')).toBe('fable');
    expect(claudeModelName('')).toBeUndefined();
    const argv = buildClaudeArgv({ ctx: ctx(), ...files });
    expect(argv[argv.indexOf('--model') + 1]).toBe('claude-sonnet-4');
    expect(buildClaudeArgv({ ctx: ctx({ model: undefined }), ...files })).not.toContain('--model');
  });

  test('system prompt 恒以文件传入；MCP 有条目时才有 --mcp-config 与 --allowedTools', () => {
    const plain = buildClaudeArgv({ ctx: ctx(), ...files });
    expect(plain[plain.indexOf('--append-system-prompt-file') + 1]).toBe('/tmp/run/system.md');
    expect(plain).not.toContain('--mcp-config');
    expect(plain).not.toContain('--allowedTools');
    const withMcp = buildClaudeArgv({
      ctx: ctx(),
      systemPromptFile: '/tmp/run/system.md',
      mcpConfigFile: '/tmp/run/mcp-config.json',
      mcpServerNames: ['cs-capabilities', 'cs-operations'],
    });
    expect(withMcp[withMcp.indexOf('--mcp-config') + 1]).toBe('/tmp/run/mcp-config.json');
    expect(withMcp[withMcp.indexOf('--allowedTools') + 1]).toBe('mcp__cs-capabilities__*,mcp__cs-operations__*');
  });

  test('resume 只在有 id 时追加', () => {
    expect(buildClaudeArgv({ ctx: ctx(), ...files })).not.toContain('--resume');
    const resumed = buildClaudeArgv({ ctx: ctx({ resumeSessionId: 'sess-1' }), ...files });
    expect(resumed[resumed.indexOf('--resume') + 1]).toBe('sess-1');
  });

  test('交互式常驻流追加 --input-format stream-json 并把 stdin 切成流模式', () => {
    const plan = buildClaudeSpawn(ctx({ interactiveStream: true }), files);
    expect(plan.cmd).toContain('--input-format');
    expect(plan.cmd.slice(5, 7)).toEqual([...CLAUDE_STREAM_INPUT_ARGV]);
    expect(plan.stdin).toEqual({ mode: 'stream' });
  });

  test('oneshot 把 prompt 经 stdin 写一次', () => {
    expect(buildClaudeSpawn(ctx(), files).stdin).toEqual({ mode: 'prompt', data: '你好' });
  });

  test('平台独占 flag 表覆盖传输、权限、会话与边界四类', () => {
    for (const flag of ['-p', '--output-format', '--input-format', '--permission-mode', '--tools', '--resume', '--settings', '--add-dir']) {
      expect(CLAUDE_PLATFORM_OWNED_FLAGS.has(flag)).toBe(true);
    }
  });

  test('沙箱关闭：从不写 --settings，也从不发 --dangerously-skip-permissions', () => {
    const argv = buildClaudeArgv({ ctx: ctx({ permission: 'full' }), ...files });
    expect(argv).not.toContain('--settings');
    expect(argv).not.toContain('--dangerously-skip-permissions');
  });
});

describe('Claude env', () => {
  test('钉 PWD 到 cwd；剔除任意大小写的 IS_SANDBOX', () => {
    const env = assembleClaudeEnv(ctx({ baseEnv: { PATH: '/usr/bin', IS_SANDBOX: '1', Is_Sandbox: '1' } }));
    expect(env.PWD).toBe('/work');
    expect(env.IS_SANDBOX).toBeUndefined();
    expect(env.Is_Sandbox).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
  });

  test('Git 身份两项同时非空才注入四个变量', () => {
    const partial = assembleClaudeEnv(ctx({ gitUserName: '张三', gitUserEmail: '' }));
    expect(partial.GIT_AUTHOR_NAME).toBeUndefined();
    const full = assembleClaudeEnv(ctx({ gitUserName: '张三', gitUserEmail: 'z@example.com' }));
    expect(full.GIT_AUTHOR_NAME).toBe('张三');
    expect(full.GIT_COMMITTER_EMAIL).toBe('z@example.com');
  });

  test('不设置 CLAUDE_CONFIG_DIR（子进程沿用自己的配置根）', () => {
    expect(assembleClaudeEnv(ctx()).CLAUDE_CONFIG_DIR).toBeUndefined();
  });
});

describe('Claude MCP 配置文件', () => {
  test('remote 渲染成 type: http；没有条目时返回 null', () => {
    expect(renderClaudeMcpConfig(ctx())).toBeNull();
    const rendered = renderClaudeMcpConfig(ctx({
      mcps: [toMcpServerSpec({ name: 'cs-ops', url: 'https://mcp.example/svc', headers: { Authorization: 'Bearer x' } })],
    }));
    expect(rendered?.names).toEqual(['cs-ops']);
    expect(JSON.parse(rendered?.json ?? '{}')).toEqual({
      mcpServers: { 'cs-ops': { type: 'http', url: 'https://mcp.example/svc', headers: { Authorization: 'Bearer x' } } },
    });
  });
});

describe('Claude 常驻输入帧', () => {
  test('一行一个 SDKUserMessage，parent_tool_use_id 为 null', () => {
    const frame = claudeUserMessageFrame('继续');
    expect(frame.endsWith('\n')).toBe(true);
    expect(JSON.parse(frame)).toEqual({ type: 'user', message: { role: 'user', content: '继续' }, parent_tool_use_id: null });
  });
});
