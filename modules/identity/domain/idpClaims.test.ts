import { describe, expect, test } from 'bun:test';
import { applyEmailTrust, assertUserinfoSubjectBinding, claimsFromIdToken, composeClaimList, extractUserinfoClaims, isOidcLoginError, readClaimField, resolveProfileNames } from './idpClaims';

const none = { subjectClaim: null, usernameClaim: null, gitNameClaim: null, emailClaim: null, claimMappings: [] };

function codeOf(fn: () => unknown): string {
  try { fn(); return 'no-throw'; } catch (error) { return isOidcLoginError(error) ? error.code : 'other'; }
}

describe('字段读取', () => {
  test('只认自有属性、非空字符串与安全整数；原型键与大数一律不读', () => {
    expect(readClaimField({ id: 'u1' }, 'id')).toBe('u1');
    expect(readClaimField({ id: 12 }, 'id')).toBe('12');
    expect(readClaimField({ id: Number.MAX_SAFE_INTEGER + 2 }, 'id')).toBeNull();
    expect(readClaimField({ id: '' }, 'id')).toBeNull();
    expect(readClaimField({}, 'toString')).toBeNull();
    expect(readClaimField({}, '__proto__')).toBeNull();
  });

  test('字段列表按序拼接，缺的跳过，全缺为 null', () => {
    expect(composeClaimList({ firstName: '张', lastName: '三' }, 'firstName lastName')).toBe('张 三');
    expect(composeClaimList({ lastName: '三' }, 'firstName lastName')).toBe('三');
    expect(composeClaimList({}, 'firstName lastName')).toBeNull();
  });
});

describe('userinfo 取身份', () => {
  test('默认只认标准 sub，不做 id 之类的隐式回落（回落等于混命名空间）', () => {
    expect(extractUserinfoClaims({ sub: 'abc' }, none).subject).toBe('abc');
    expect(codeOf(() => extractUserinfoClaims({ id: 'abc' }, none))).toBe('userinfo-shape-invalid');
    expect(codeOf(() => extractUserinfoClaims([{ sub: 'abc' }], none))).toBe('userinfo-shape-invalid');
  });

  test('配了主体字段就以它为准，取不到直接失败', () => {
    const selectors = { ...none, subjectClaim: 'employeeId' };
    expect(extractUserinfoClaims({ employeeId: 90021, sub: 'other' }, selectors).subject).toBe('90021');
    expect(codeOf(() => extractUserinfoClaims({ sub: 'other' }, selectors))).toBe('userinfo-shape-invalid');
  });

  test('邮箱：标准字段容错，配了选择器就严格——填错字段名必须报错而不是当成没邮箱', () => {
    expect(extractUserinfoClaims({ sub: 'a', email: ' USER@Corp.COM ' }, none).email).toBe('user@corp.com');
    expect(extractUserinfoClaims({ sub: 'a' }, none).email).toBeNull();
    expect(codeOf(() => extractUserinfoClaims({ sub: 'a' }, { ...none, emailClaim: 'mail' }))).toBe('email-claim-invalid');
    expect(codeOf(() => extractUserinfoClaims({ sub: 'a', mail: 'not-an-email' }, { ...none, emailClaim: 'mail' }))).toBe('email-claim-invalid');
  });

  test('显示名与 Git 名选择器：取不到就失败，不偷偷回落标准字段', () => {
    const selectors = { ...none, usernameClaim: 'firstName lastName', gitNameClaim: 'gitId' };
    const claims = extractUserinfoClaims({ sub: 'a', firstName: '张', lastName: '三', gitId: 'zhangsan' }, selectors);
    expect(claims.preferredUsername).toBe('张 三');
    expect(claims.gitName).toBe('zhangsan');
    expect(codeOf(() => extractUserinfoClaims({ sub: 'a', preferred_username: 'fallback' }, selectors))).toBe('display-name-claim-invalid');
    expect(codeOf(() => extractUserinfoClaims({ sub: 'a', firstName: '张' }, selectors))).toBe('git-name-claim-invalid');
  });

  test('自定义映射进 attrs，缺的字段直接不出现（不注入空值）', () => {
    const selectors = { ...none, claimMappings: [{ key: 'employee-no', claim: 'empNo' }, { key: 'department', claim: 'deptName' }] };
    expect(extractUserinfoClaims({ sub: 'a', empNo: 'E-9', deptName: '' }, selectors).attrs).toEqual({ 'employee-no': 'E-9' });
  });
});

describe('id_token 与绑定', () => {
  test('空 sub 拒绝：绝不把缺失主体拼成空串建一条无主体的身份', () => {
    expect(claimsFromIdToken({ sub: 'abc', email: 'a@b.com' }, { usernameClaim: null, claimMappings: [] }).subject).toBe('abc');
    expect(codeOf(() => claimsFromIdToken({ sub: '' }, { usernameClaim: null, claimMappings: [] }))).toBe('id-token-verify-failed');
  });

  test('配了档案选择器时 userinfo 必须绑定在已验证主体上', () => {
    expect(() => assertUserinfoSubjectBinding({ sub: 'abc' }, 'abc')).not.toThrow();
    expect(codeOf(() => assertUserinfoSubjectBinding({ sub: 'other' }, 'abc'))).toBe('userinfo-subject-mismatch');
    expect(codeOf(() => assertUserinfoSubjectBinding({}, 'abc'))).toBe('userinfo-subject-mismatch');
  });
});

describe('邮箱可信与档案名', () => {
  test('声明可信时有邮箱即视为已验证；没有邮箱不凭空造一个已验证', () => {
    const base = extractUserinfoClaims({ sub: 'a', email: 'x@corp.com' }, none);
    expect(applyEmailTrust(base, true).emailVerified).toBe(true);
    expect(applyEmailTrust(base, false).emailVerified).toBe(false);
    expect(applyEmailTrust(extractUserinfoClaims({ sub: 'a' }, none), true).emailVerified).toBe(false);
  });

  test('没配选择器时按 preferred_username → name → email 回落，Git 名跟随显示名', () => {
    const claims = extractUserinfoClaims({ sub: 'a', name: '张三', email: 'z@corp.com' }, none);
    expect(resolveProfileNames({ usernameClaim: null, gitNameClaim: null }, claims)).toEqual({ displayName: '张三', gitName: '张三' });
    const anonymous = extractUserinfoClaims({ sub: 'a' }, none);
    expect(resolveProfileNames({ usernameClaim: null, gitNameClaim: null }, anonymous).displayName).toBe('OIDC 用户');
  });
});
