import { describe, expect, test } from 'bun:test';
import { ManifestSchema, operationKey } from './manifest';

const designExample = {
  apiVersion: 'crewstation/v1',
  kind: 'DigitalWorker',
  spec: {
    service: { command: ['bun', 'run', 'src/main.ts'], port: 3000, healthPath: '/healthz', plan: 'standard-small', replicas: 2, releaseMode: 'rolling-compatible' },
    env: [{ name: 'ISSUE_API_BASE', from: 'config' }, { name: 'NOTIFY_TOKEN', from: 'secret' }],
    apis: { requested: [{ proxy: 'issues', method: 'GET', path: '/v1/issues/{id}' }], exposes: { openapi: './openapi.yaml' } },
    subscriptions: [{ eventType: 'gitlab.pipeline.finished', handlerPath: '/events/pipeline' }],
    tasks: {
      profile: 'coding-medium',
      defaultVolumeMode: 'follow-container',
      agentProfiles: [{ name: 'analysis-v1', compute: 'balanced', permission: 'read-only' }],
      outputContracts: [{ name: 'analysis-report-v1', required: ['reports/analysis.md'], schema: './contracts/analysis-report.schema.json' }],
    },
    release: { migrationCommand: ['bun', 'run', 'db:migrate'], migration: { compatibility: 'expand-only', destructive: false, rollback: 'switch-back' } },
  },
};

describe('Manifest', () => {
  test('Design §4.1 示例可解析', () => {
    const parsed = ManifestSchema.parse(designExample);
    expect(parsed.kind).toBe('DigitalWorker');
    if (parsed.kind === 'DigitalWorker') expect(parsed.spec.tasks?.agentProfiles[0]?.permission).toBe('read-only');
  });
  test('Agent 档案只认 compute：写 driver 或 model 会被拒（RFC-001）', () => {
    // zod 默认剥掉未知键，旧写法会被静默丢弃、业务以为自己指定了驱动，因此这里必须 strict。
    const withDriver = structuredClone(designExample);
    withDriver.spec.tasks.agentProfiles = [{ name: 'a', compute: 'balanced', driver: 'claude-code', permission: 'read-only' } as never];
    const bad = ManifestSchema.safeParse(withDriver);
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('driver');

    const withModel = structuredClone(designExample);
    withModel.spec.tasks.agentProfiles = [{ name: 'a', compute: 'balanced', model: 'anthropic/claude-opus-5', permission: 'read-only' } as never];
    expect(ManifestSchema.safeParse(withModel).success).toBe(false);
  });

  test('config 项可带 default，secret 不可', () => {
    const withDefault = { ...designExample, spec: { ...designExample.spec, env: [{ name: 'GREETING', from: 'config', default: '你好' }] } };
    const parsed = ManifestSchema.parse(withDefault);
    if (parsed.kind === 'DigitalWorker') expect(parsed.spec.env[0]?.default).toBe('你好');
    const secretDefault = { ...designExample, spec: { ...designExample.spec, env: [{ name: 'NOTIFY_TOKEN', from: 'secret', default: 'leak' }] } };
    expect(ManifestSchema.safeParse(secretDefault).success).toBe(false);
  });
  test('agentProfiles 重名被拒', () => {
    const bad = structuredClone(designExample);
    bad.spec.tasks.agentProfiles.push({ ...bad.spec.tasks.agentProfiles[0]! });
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });
  test('APIProxy 必须声明 exposes 与 upstream', () => {
    const proxy = { apiVersion: 'crewstation/v1', kind: 'APIProxy', spec: { service: { command: ['bun', 'x'], port: 3000, plan: 'standard-small' }, proxy: 'issues', upstream: { connection: 'gitlab-main' }, apis: { exposes: { openapi: './openapi.yaml' } } } };
    expect(ManifestSchema.safeParse(proxy).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...proxy, spec: { ...proxy.spec, apis: {} } }).success).toBe(false);
  });
  test('操作键格式', () => {
    expect(operationKey('issues', 'get', '/v1/issues/{id}')).toBe('issues:GET:/v1/issues/{id}');
  });
});
