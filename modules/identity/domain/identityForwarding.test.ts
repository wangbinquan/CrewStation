import { describe, expect, test } from 'bun:test';
import { attrHeaderName, effectiveForwardingFields, forwardedHeaders, forwardedTokenClaims, forwardingCandidates, forwardingProjection } from './identityForwarding';

const profile = { name: '张三', email: 'zhang@corp.com', gitName: 'zhangsan', attrs: { 'employee-no': 'E-9', department: '平台组' } };
const candidates = forwardingCandidates([
  { slug: 'corp-sso', claimMappings: [{ key: 'employee-no', claim: 'empNo' }, { key: 'department', claim: 'deptName' }] },
  { slug: 'lab-sso', claimMappings: [{ key: 'employee-no', claim: 'staffId' }] },
]);

describe('候选字段', () => {
  test('三个固定字段加各 Provider 的自定义映射；同名映射合并并列出声明它的 Provider', () => {
    expect(candidates.filter((c) => c.kind === 'fixed').map((c) => c.key)).toEqual(['name', 'email', 'git-name']);
    expect(candidates.find((c) => c.key === 'employee-no')).toEqual({ key: 'employee-no', kind: 'mapped', providers: ['corp-sso', 'lab-sso'] });
  });
});

describe('生效集', () => {
  test('项目覆盖优先，没有覆盖才用全局默认', () => {
    expect(effectiveForwardingFields({ global: ['name', 'email'], project: undefined }, candidates)).toEqual({ fields: ['email', 'name'], source: 'global' });
    expect(effectiveForwardingFields({ global: ['name', 'email'], project: ['name'] }, candidates)).toEqual({ fields: ['name'], source: 'project' });
    // 覆盖成空集是合法的收紧，不是「没配」。
    expect(effectiveForwardingFields({ global: ['name'], project: [] }, candidates)).toEqual({ fields: [], source: 'project' });
  });

  test('映射被删掉后集合里的残留字段直接忽略，不注入空头', () => {
    expect(effectiveForwardingFields({ global: ['name', 'gone-key'], project: undefined }, candidates).fields).toEqual(['name']);
  });
});

describe('注入投影', () => {
  test('关掉的字段头与声明同时消失，而不是给一个空串', () => {
    const headers = forwardedHeaders(['name'], profile);
    expect(headers['x-cs-user-name']).toBe('张三');
    expect(headers).not.toHaveProperty('x-cs-user-email');
    const claims = forwardedTokenClaims(['name'], profile);
    expect(claims).toEqual({ name: '张三' });
  });

  test('自定义字段走 x-cs-user-attr- 前缀与 cs_attrs 声明，两侧同源', () => {
    const fields = ['name', 'email', 'git-name', 'employee-no'];
    expect(forwardedHeaders(fields, profile)).toEqual({
      'x-cs-user-name': '张三',
      'x-cs-user-email': 'zhang@corp.com',
      [attrHeaderName('git-name')]: 'zhangsan',
      [attrHeaderName('employee-no')]: 'E-9',
    });
    expect(forwardedTokenClaims(fields, profile)).toEqual({ name: '张三', email: 'zhang@corp.com', cs_attrs: { 'git-name': 'zhangsan', 'employee-no': 'E-9' } });
  });

  test('档案里没有的自定义字段不出现；没有 attrs 时不带空的 cs_attrs', () => {
    expect(forwardedHeaders(['department', 'unknown'], { ...profile, attrs: {} })).toEqual({});
    expect(forwardedTokenClaims(['name'], { ...profile, attrs: {} })).not.toHaveProperty('cs_attrs');
  });

  test('生效预览与实际注入同源：用户 ID 与身份令牌恒定在列，不受集合影响', () => {
    const projection = forwardingProjection(['name', 'employee-no']);
    expect(projection.headers).toContain('x-cs-user-id');
    expect(projection.headers).toContain('x-cs-identity-token');
    expect(projection.headers).toContain(attrHeaderName('employee-no'));
    expect(projection.tokenClaims).toEqual(['cs_attrs.employee-no', 'name']);
    expect(forwardingProjection([]).headers).toEqual(['x-cs-identity-token', 'x-cs-user-id']);
  });
});
