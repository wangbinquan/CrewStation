import { describe, expect, test } from 'bun:test';
import { parseEnvLines } from '../agentEnvFile';
import { loadConfigFromEnv, RunnerConfigError } from '../config';
import { compileJsonSchema } from './jsonSchemaValidator';

describe('compileJsonSchema', () => {
  test('draft-07 缺省、2020-12 按 $schema 选择、错误带 instancePath', () => {
    const draft7 = compileJsonSchema({ type: 'object', required: ['a'], properties: { a: { type: 'integer' } } });
    expect(draft7.ok).toBe(true);
    if (!draft7.ok) return;
    expect(draft7.value.validate({ a: 1 })).toEqual([]);
    const errors = draft7.value.validate({ a: 'x' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\/a must be integer/);

    const modern = compileJsonSchema({ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array', prefixItems: [{ type: 'string' }], items: false });
    expect(modern.ok).toBe(true);
    if (!modern.ok) return;
    expect(modern.value.validate(['ok'])).toEqual([]);
    expect(modern.value.validate(['ok', 'extra']).length).toBeGreaterThan(0);

    const lenient = compileJsonSchema({ type: 'string', format: 'made-up-format', 'x-custom': true });
    expect(lenient.ok).toBe(true);
    if (lenient.ok) expect(lenient.value.validate('anything')).toEqual([]);
  });
  test('非对象或非法 schema 返回 err', () => {
    expect(compileJsonSchema('nope').ok).toBe(false);
    expect(compileJsonSchema({ type: 'not-a-type' }).ok).toBe(false);
  });
});

describe('parseEnvLines', () => {
  test('KEY=VALUE、export、注释、引号；非法行回调而不抛', () => {
    const invalid: Array<[number, string]> = [];
    const parsed = parseEnvLines(['# comment', '', 'ANTHROPIC_API_KEY=sk-test', 'export OPENAI_API_KEY="quoted=value"', "SINGLE='a b'", 'BAD LINE', '=nokey', '1ABC=x'].join('\n'), (line, reason) => invalid.push([line, reason]));
    expect(parsed).toEqual({ ANTHROPIC_API_KEY: 'sk-test', OPENAI_API_KEY: 'quoted=value', SINGLE: 'a b' });
    expect(invalid).toEqual([[6, 'missing ='], [7, 'missing ='], [8, 'invalid key']]);
  });
});

describe('loadConfigFromEnv', () => {
  const base = { CS_TASK_ID: 'tsk_0123456789abcdef0123456789abcdef', CS_RUNNER_TOKEN: 't', CS_SESSION_URL: 'ws://cs-session.crewstation-system:8083/runner' };
  test('缺省值与预览命令解析', () => {
    const config = loadConfigFromEnv(base);
    expect(config).toMatchObject({ workdir: '/work', workerUid: 10001, workerGid: 10001, terminalBackend: 'auto', replayCapacity: 5000 });
    expect(config.preview).toBeUndefined();
    const withPreview = loadConfigFromEnv({ ...base, CS_WORKDIR: '/srv', CS_WORKER_UID: '2000', CS_PREVIEW_COMMAND: '["bun","run","dev"]', CS_PREVIEW_PORT: '3000', CS_PREVIEW_HEALTH_PATH: '/healthz', CS_TERMINAL_BACKEND: 'script' });
    expect(withPreview.preview).toEqual({ command: ['bun', 'run', 'dev'], port: 3000, healthPath: '/healthz' });
    expect(withPreview).toMatchObject({ workdir: '/srv', workerUid: 2000, workerGid: 10001, terminalBackend: 'script' });
  });
  test('缺少必填、非法任务 ID、预览配置不完整都报 RunnerConfigError', () => {
    expect(() => loadConfigFromEnv({ ...base, CS_TASK_ID: undefined })).toThrow(RunnerConfigError);
    expect(() => loadConfigFromEnv({ ...base, CS_TASK_ID: 'dev' })).toThrow(RunnerConfigError);
    expect(() => loadConfigFromEnv({ ...base, CS_PREVIEW_COMMAND: '["bun"]' })).toThrow(/CS_PREVIEW_PORT/);
    expect(() => loadConfigFromEnv({ ...base, CS_PREVIEW_COMMAND: 'bun run dev', CS_PREVIEW_PORT: '3000' })).toThrow(/JSON/);
    expect(() => loadConfigFromEnv({ ...base, CS_WORKER_UID: '-1' })).toThrow(RunnerConfigError);
    expect(() => loadConfigFromEnv({ ...base, CS_TERMINAL_BACKEND: 'tmux' })).toThrow(RunnerConfigError);
  });
});
