import { describe, expect, test } from 'bun:test';
import { ComputeProfileContentSchema, ComputeProfileNameSchema, CreateComputeProfileRequestSchema, DEFAULT_COMPUTE_PROFILE } from '../api/compute/computeProfile';
import { AgentProfileSchema } from '../manifest/tasks';
import { LaunchSpecSchema, isPlatformSpawnEnv, reservedLaunchArg } from './launch';

const ok = (spec: Record<string, unknown>) => LaunchSpecSchema.safeParse(spec).success;

describe('LaunchSpec 按协议的字段适用矩阵（RFC-006 proposal §5.1）', () => {
  test('二进制路径必填且必须是容器内绝对路径', () => {
    expect(ok({ protocol: 'claude-code' })).toBe(false);
    expect(ok({ protocol: 'claude-code', binaryPath: 'claude' })).toBe(false);
    expect(ok({ protocol: 'claude-code', binaryPath: '/usr/local/bin/claude' })).toBe(true);
  });
  test('附加参数只给 claude-code 与 terminal；IS_SANDBOX 只给 claude-code', () => {
    expect(ok({ protocol: 'claude-code', binaryPath: '/b', extraArgs: ['--foo'], isSandbox: true })).toBe(true);
    expect(ok({ protocol: 'terminal', binaryPath: '/b', extraArgs: ['--foo'] })).toBe(true);
    expect(ok({ protocol: 'opencode', binaryPath: '/b', extraArgs: ['--foo'] })).toBe(false);
    expect(ok({ protocol: 'opencode', binaryPath: '/b', isSandbox: true })).toBe(false);
    expect(ok({ protocol: 'terminal', binaryPath: '/b', isSandbox: true })).toBe(false);
  });
  test('配置目录覆盖只给两种已知协议；终端不带模型；opencode 参数只给 opencode', () => {
    expect(ok({ protocol: 'opencode', binaryPath: '/b', configDirEnv: 'MY_OPENCODE_DIR', configDirName: 'my-opencode', opencode: { variant: 'high', temperature: 0.2, steps: 5, maxSteps: 50 } })).toBe(true);
    expect(ok({ protocol: 'terminal', binaryPath: '/b', configDirEnv: 'X_DIR' })).toBe(false);
    expect(ok({ protocol: 'terminal', binaryPath: '/b', configDirName: 'x' })).toBe(false);
    expect(ok({ protocol: 'terminal', binaryPath: '/b', model: 'm' })).toBe(false);
    expect(ok({ protocol: 'claude-code', binaryPath: '/b', opencode: { steps: 3 } })).toBe(false);
    expect(ok({ protocol: 'opencode', binaryPath: '/b', configDirName: '../escape' })).toBe(false);
  });
  test('平台保留参数与保留环境变量前缀', () => {
    expect(reservedLaunchArg('claude-code', '--model')).toBe('--model');
    expect(reservedLaunchArg('claude-code', '--permission-mode=plan')).toBe('--permission-mode');
    expect(reservedLaunchArg('claude-code', '--foo')).toBeUndefined();
    expect(reservedLaunchArg('terminal', '--model')).toBeUndefined();
    expect(isPlatformSpawnEnv('CS_MCP_TOKEN')).toBe(true);
    expect(isPlatformSpawnEnv('MY_DIR')).toBe(false);
  });
});

describe('档位名与 Manifest 的 default（C13、C17）', () => {
  test('default 是保留名：管理员不能建叫 default 的档位；Manifest 可以写 default', () => {
    expect(ComputeProfileNameSchema.safeParse(DEFAULT_COMPUTE_PROFILE).success).toBe(false);
    expect(ComputeProfileNameSchema.safeParse('balanced').success).toBe(true);
    expect(AgentProfileSchema.safeParse({ name: 'chat-v1', compute: 'default', permission: 'read-only' }).success).toBe(true);
  });
  test('创建请求：镜像、launch 与通用终端的测试命令一起校验', () => {
    const content = { image: 'registry.local:5000/runtime/tool:1', launch: { protocol: 'terminal', binaryPath: '/opt/tool/bin/tool' }, terminalTest: { command: ['/opt/tool/bin/tool', '--version'], expect: 'tool \\d' } };
    expect(ComputeProfileContentSchema.safeParse(content).success).toBe(true);
    expect(CreateComputeProfileRequestSchema.safeParse({ name: 'tool-cli', description: '', content }).success).toBe(true);
  });
});
