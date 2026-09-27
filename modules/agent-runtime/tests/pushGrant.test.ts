import { describe, expect, test } from 'bun:test';
import type { PushGrant } from '../domain/pushGrant';
import { registryDecision, signGrant, verifyGrant } from '../domain/pushGrant';

const key = new TextEncoder().encode('k'.repeat(32));
const grant: PushGrant = { sub: '01a0bf5d-8f4b-7ac9-8852-aff2e92a734c', exp: 2_000, push: ['runtime/'], pull: ['runtime/', 'crewstation/task-runtime'] };

describe('推送凭据（RFC-006 C18）', () => {
  test('签名、到期与篡改：只有同一密钥签发且未到期的口令有效', () => {
    const token = signGrant(grant, key);
    expect(verifyGrant(token, key, 1_999)).toEqual(grant);
    expect(verifyGrant(token, key, 2_000)).toBeUndefined();
    expect(verifyGrant(token, new TextEncoder().encode('x'.repeat(32)), 1_000)).toBeUndefined();
    const [body, mac] = token.split('.') as [string, string];
    const widened = Buffer.from(JSON.stringify({ ...grant, push: [''] })).toString('base64url');
    expect(verifyGrant(`${widened}.${mac}`, key, 1_000)).toBeUndefined();
    expect(verifyGrant(`${body}.${mac}.x`, key, 1_000)).toBeUndefined();
    expect(verifyGrant('not-a-token', key, 1_000)).toBeUndefined();
  });

  test('路径裁定：探测放行；前缀内推拉但不删除；底座只读；目录列举、其他仓库与路径穿越一律拒绝', () => {
    expect(registryDecision(grant, 'GET', '/v2/')).toBe('allow');
    expect(registryDecision(grant, 'POST', '/v2/')).toBe('deny');
    expect(registryDecision(grant, 'POST', '/v2/runtime/my-cli/blobs/uploads/')).toBe('allow');
    expect(registryDecision(grant, 'HEAD', '/v2/runtime/team/my-cli/blobs/sha256:abc')).toBe('allow');
    expect(registryDecision(grant, 'DELETE', '/v2/runtime/my-cli/manifests/1')).toBe('deny');
    expect(registryDecision(grant, 'GET', '/v2/crewstation/task-runtime/manifests/dev')).toBe('allow');
    expect(registryDecision(grant, 'PUT', '/v2/crewstation/task-runtime/manifests/dev')).toBe('deny');
    expect(registryDecision(grant, 'GET', '/v2/crewstation/task-runtime-evil/manifests/dev')).toBe('deny');
    expect(registryDecision(grant, 'GET', '/v2/_catalog')).toBe('deny');
    expect(registryDecision(grant, 'GET', '/v2/runtime/../cs-api/manifests/dev')).toBe('deny');
    expect(registryDecision(grant, 'GET', '/v2/runtimex/app/manifests/1')).toBe('deny');
  });

  test('构建凭据跨仓库挂载同时要求来源读取权，不能借目标写权复制别的项目 blob', () => {
    const scoped: PushGrant = { ...grant, push: ['runtime/projects/p1/b1/'], pull: ['crewstation/task-runtime'] };
    const target = '/v2/runtime/projects/p1/b1/image/blobs/uploads/';
    const digest = `sha256:${'a'.repeat(64)}`;
    const mount = (from: string) => `${target}?mount=${digest}&from=${encodeURIComponent(from)}`;
    expect(registryDecision(scoped, 'POST', mount('crewstation/task-runtime'))).toBe('allow');
    expect(registryDecision(scoped, 'POST', mount('runtime/projects/p1/b1/other'))).toBe('allow');
    for (const from of ['runtime/projects/p2/b1/image', 'runtime/projects/p1/b2/image', 'crewstation/task-runtime/private', '../crewstation/task-runtime']) {
      expect(registryDecision(scoped, 'POST', mount(from))).toBe('deny');
    }
    expect(registryDecision(scoped, 'POST', `${target}?mount=${digest}`)).toBe('deny');
    expect(registryDecision(scoped, 'POST', `${mount('crewstation/task-runtime')}&from=private/image`)).toBe('deny');
    expect(registryDecision(scoped, 'POST', `${mount('crewstation/task-runtime')}&mount=${digest}`)).toBe('deny');
    expect(registryDecision(scoped, 'GET', '/v2/crewstation/task-runtime/private/manifests/v1')).toBe('deny');
    expect(registryDecision(scoped, 'PATCH', `${target}upload-id?_state=signed-state`)).toBe('allow');
  });
});
