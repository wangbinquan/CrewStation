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
});
