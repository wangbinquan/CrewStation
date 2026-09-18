import { expect, test } from 'bun:test';
import { decideProvisioning } from './provisioning';

const verified = { email: 'zhang@corp.com', emailVerified: true };
const auto = { provisioning: 'auto' as const, allowedEmailDomains: [] };
const allowlist = { provisioning: 'allowlist' as const, allowedEmailDomains: ['@corp.com', '@sub.corp.com'] };

test('已有身份即登录，与策略无关——策略只管新账户怎么产生', () => {
  expect(decideProvisioning(allowlist, { email: null, emailVerified: false }, 'usr_1')).toEqual({ action: 'login', userId: 'usr_1' });
});

test('auto：任何成功登录即建档，不查邮箱', () => {
  expect(decideProvisioning(auto, { email: null, emailVerified: false }, null)).toEqual({ action: 'create' });
});

test('allowlist：邮箱已验证且域名命中才建档', () => {
  expect(decideProvisioning(allowlist, verified, null)).toEqual({ action: 'create' });
  expect(decideProvisioning(allowlist, { ...verified, email: 'x@SUB.CORP.COM' }, null)).toEqual({ action: 'create' });
});

test('allowlist 的两条拒绝：未验证与域名不符，原因各自可辨', () => {
  expect(decideProvisioning(allowlist, { ...verified, emailVerified: false }, null)).toEqual({ action: 'reject', reason: 'email-not-verified' });
  expect(decideProvisioning(allowlist, { email: null, emailVerified: true }, null)).toEqual({ action: 'reject', reason: 'email-not-verified' });
  expect(decideProvisioning(allowlist, { email: 'zhang@other.com', emailVerified: true }, null)).toEqual({ action: 'reject', reason: 'email-domain-not-allowed' });
});
