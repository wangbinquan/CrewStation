import { describe, expect, test } from 'bun:test';
import { ManifestSchema, operationSignature } from './manifest';

const designExample = {
  apiVersion: 'crewstation/v2',
  kind: 'DigitalWorker',
  spec: {
    service: { command: ['bun', 'run', 'src/main.ts'], port: 3000, healthPath: '/healthz', servicePlanId: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10', replicas: 2, releaseMode: 'rolling-compatible' },
    env: [{ configDefinitionId: '01a0bf5d-8f4b-70cf-8eec-d368914d759c', name: 'ISSUE_API_BASE', from: 'config' }, { configDefinitionId: '01a0bf5d-8f4b-7959-897c-e593a671f40f', name: 'NOTIFY_TOKEN', from: 'secret' }],
    apis: { requested: [{ operationId: '01a0bf5d-8f4b-79bf-85a2-4e4aa779981a' }], exposes: { openapi: './openapi.yaml' } },
    subscriptions: [{ eventTypeId: '01a0bf5d-8f4b-7df1-807c-e09dc66a52c8', handlerPath: '/events/pipeline' }],
    tasks: {
      taskProfileId: '01a0bf5d-8f4b-7001-8458-107366e7de39',
      defaultVolumeMode: 'follow-container',
      agentProfiles: [{ id: '01a0bf5d-8f4b-7f44-8e85-c4b8ea2addc7', name: 'analysis-v1', compute: { kind: 'profile', profileId: '01a0bf5d-8f4b-7c09-8050-88ba5b806778' } }],
      outputContracts: [{ id: '01a0bf5d-8f4b-7a1a-8e62-7cb41deda432', name: 'analysis-report-v1', required: ['reports/analysis.md'], schema: './contracts/analysis-report.schema.json' }],
    },
    release: { migrationCommand: ['bun', 'run', 'db:migrate'], migration: { compatibility: 'expand-only', destructive: false, rollback: 'switch-back' } },
  },
};

describe('Manifest', () => {
  test('Manifest v2 的完整资源引用示例可解析', () => {
    const parsed = ManifestSchema.parse(designExample);
    expect(parsed.kind).toBe('DigitalWorker');
  });
  test('agentProfiles[].permission 已作废（D59）：旧仓库的写法照收，缺省也不再补一档', () => {
    const legacy = structuredClone(designExample);
    legacy.spec.tasks.agentProfiles = [{ ...designExample.spec.tasks.agentProfiles[0]!, permission: 'read-only' } as never];
    expect(ManifestSchema.safeParse(legacy).success).toBe(true);
    const parsed = ManifestSchema.parse(designExample);
    if (parsed.kind === 'DigitalWorker') expect(parsed.spec.tasks?.agentProfiles[0]).not.toHaveProperty('permission');
  });
  test('Agent 档案只认 compute：写 driver 或 model 会被拒（RFC-001）', () => {
    // zod 默认剥掉未知键，旧写法会被静默丢弃、业务以为自己指定了驱动，因此这里必须 strict。
    const withDriver = structuredClone(designExample);
    withDriver.spec.tasks.agentProfiles = [{ ...designExample.spec.tasks.agentProfiles[0]!, driver: 'claude-code' } as never];
    const bad = ManifestSchema.safeParse(withDriver);
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('driver');

    const withModel = structuredClone(designExample);
    withModel.spec.tasks.agentProfiles = [{ ...designExample.spec.tasks.agentProfiles[0]!, model: 'anthropic/claude-opus-5' } as never];
    expect(ManifestSchema.safeParse(withModel).success).toBe(false);
  });

  test('config 项可带 default，secret 不可', () => {
    const withDefault = { ...designExample, spec: { ...designExample.spec, env: [{ configDefinitionId: '01a0bf5d-8f4b-737a-877b-e39a30e18ab9', name: 'GREETING', from: 'config', default: '你好' }] } };
    const parsed = ManifestSchema.parse(withDefault);
    if (parsed.kind === 'DigitalWorker') expect(parsed.spec.env[0]?.default).toBe('你好');
    const secretDefault = { ...designExample, spec: { ...designExample.spec, env: [{ configDefinitionId: '01a0bf5d-8f4b-7959-897c-e593a671f40f', name: 'NOTIFY_TOKEN', from: 'secret', default: 'leak' }] } };
    expect(ManifestSchema.safeParse(secretDefault).success).toBe(false);
  });
  test('agentProfiles 重复身份被拒', () => {
    const bad = structuredClone(designExample);
    bad.spec.tasks.agentProfiles.push({ ...bad.spec.tasks.agentProfiles[0]! });
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });
  test('APIProxy 必须声明 exposes 与 upstream', () => {
    const proxy = { apiVersion: 'crewstation/v2', kind: 'APIProxy', spec: { service: { command: ['bun', 'x'], port: 3000, servicePlanId: '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10' }, proxy: 'issues', upstream: { connection: 'gitlab-main' }, apis: { exposes: { openapi: './openapi.yaml' } } } };
    expect(ManifestSchema.safeParse(proxy).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...proxy, spec: { ...proxy.spec, apis: {} } }).success).toBe(false);
  });
  test('操作键格式', () => {
    expect(operationSignature('issues', 'get', '/v1/issues/{id}')).toBe('issues:GET:/v1/issues/{id}');
  });
});
