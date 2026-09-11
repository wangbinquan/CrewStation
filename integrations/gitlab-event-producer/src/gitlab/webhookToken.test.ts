import { describe, expect, test } from 'bun:test';
import { verifyWebhookToken } from './webhookToken';

describe('verifyWebhookToken', () => {
  test('一致才通过', () => {
    expect(verifyWebhookToken('s3cret', 's3cret')).toEqual({ ok: true });
    expect(verifyWebhookToken('s3cret', 's3crEt').ok).toBe(false);
    expect(verifyWebhookToken('s3cret ', 's3cret').ok).toBe(false);
  });

  test('长度不同不抛错，按不一致处理', () => {
    expect(verifyWebhookToken('short', 'a-much-longer-secret').ok).toBe(false);
    expect(verifyWebhookToken('a-much-longer-secret', 'short').ok).toBe(false);
  });

  test('未配置密钥时一律拒绝，绝不退化成“不校验”', () => {
    for (const expected of [undefined, null, '']) {
      const check = verifyWebhookToken('anything', expected);
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.reason).toContain('未配置');
    }
  });

  test('缺请求头时说明缺的是哪一个，且不回显密钥', () => {
    const check = verifyWebhookToken(null, 's3cret');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toContain('x-gitlab-token');
      expect(check.reason).not.toContain('s3cret');
    }
    expect(verifyWebhookToken('', 's3cret').ok).toBe(false);
  });

  test('不一致的说明里不带任何一侧的明文', () => {
    const check = verifyWebhookToken('wrong-token', 'right-token');
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).not.toContain('wrong-token');
      expect(check.reason).not.toContain('right-token');
    }
  });
});
