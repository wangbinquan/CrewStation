import { expect, test } from 'bun:test';
import { ManifestSchema } from './manifest';
import { LegacyManifestSchema } from './legacy/manifest';

const id = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10';
const service = { command: ['app'], port: 3000, servicePlanId: id };
const data = { objects: { planId: id } };
const base = { apiVersion: 'crewstation/v3', kind: 'DigitalWorker', spec: { service, data } };

test('v3 数字人保留对象档位，未声明的服务不被自动启用存储', () => {
  expect(ManifestSchema.parse(base).spec).toHaveProperty('data', data);
  const previous = ManifestSchema.parse({ ...base, spec: { service } });
  expect(previous.spec).not.toHaveProperty('data');
});

test('v2 与旧 v1 明确拒绝对象声明，不能解析成功后静默丢弃', () => {
  const v2 = ManifestSchema.safeParse({ ...base, apiVersion: 'crewstation/v2' });
  expect(v2.success).toBe(false);
  expect(v2.error?.issues.some((issue) => issue.message.includes('crewstation/v3'))).toBe(true);
  expect(LegacyManifestSchema.safeParse({ ...base, apiVersion: 'crewstation/v1', spec: { service: { command: ['app'], port: 3000, plan: 'small' }, data } }).success).toBe(false);
});

test('APIProxy 和 EventProducer 不接受对象声明，即使使用 v3', () => {
  for (const variant of [
    { kind: 'APIProxy', spec: { proxy: 'test', upstream: { connection: 'upstream' }, apis: { exposes: { openapi: 'openapi.yaml' } } } },
    { kind: 'EventProducer', spec: { producer: 'test', ingress: { path: '/events' }, produces: [{ eventType: 'example.event' }] } },
  ]) {
    expect(ManifestSchema.safeParse({ ...base, kind: variant.kind, spec: { service, ...variant.spec } }).success).toBe(true);
    expect(ManifestSchema.safeParse({ ...base, kind: variant.kind, spec: { service, ...variant.spec, data } }).success).toBe(false);
  }
});

test('存储声明拒绝后端私选、未知字段与无效档位 ID', () => {
  for (const invalid of [{ objects: { planId: 'small' } }, { objects: { planId: id, backendId: id } }, { ...data, pvc: {} }, { objects: {} }]) {
    expect(ManifestSchema.safeParse({ ...base, spec: { service, data: invalid } }).success).toBe(false);
  }
});
