import { describe, expect, test } from 'bun:test';
import { MODEL_FAIL_SIGNATURES, classifyProtocolFailure } from '../domain/profileTestClassifier';

// 回归用例移植自 agent-workflow tests/runtime-smoke-status-code-signatures.test.ts 与 runtime-smoke.test.ts（RFC-006 §6.2）。
describe('档位测试失败分类：顺序为 超时 → 网络 → 鉴权 → 模型 → 不符合协议', () => {
  test('真状态码与模型失败特征词命中模型失败', () => {
    for (const s of ['error: 503 Service Unavailable', 'API Error: 529 overloaded', 'HTTP 503', 'http/1.1 503 bad', 'status: 529', 'code: 503', '503 service unavailable',
      '{"status": 503, "message": "overloaded"}', 'status_code=529', 'statuscode: 503', 'rate limit exceeded', 'quota exceeded', 'model gpt-x not found', 'too many requests',
      'Overloaded', 'insufficient credits', 'does not have access to model foo', '您暂无该模型的使用权限', '该模型的使用权限未开通']) {
      expect(MODEL_FAIL_SIGNATURES.test(s.toLowerCase()), s).toBe(true);
      expect(classifyProtocolFailure({ timedOut: false, haystack: s }), s).toBe('model-call-failed');
    }
  });

  test('任意位置的三连数字不得命中：nonce、提交号、字节数、端口、耗时', () => {
    for (const s of ['crewstation-test-a503bc12', 'crewstation-test-ff529e01', 'commit 529ab3f', 'wrote 5031 bytes', 'listening on port 5290', 'took 503ms',
      'took 503 ms', 'wrote 529 bytes', '503 files changed', 'retry after 529 seconds', 'exit 503', 'pid 503 exited']) {
      expect(MODEL_FAIL_SIGNATURES.test(s.toLowerCase()), s).toBe(false);
      expect(classifyProtocolFailure({ timedOut: false, haystack: s }), s).toBe('stream-nonconforming');
    }
  });

  test('十万次真实形态的测试 nonce 零误命中', () => {
    let hit = 0;
    for (let i = 0; i < 100_000; i++) {
      const hex = Array.from({ length: 16 }, () => '0123456789abcdef'.charAt(Math.floor(Math.random() * 16))).join('');
      if (MODEL_FAIL_SIGNATURES.test(`crewstation-test-${hex}`)) hit++;
    }
    expect(hit).toBe(0);
  });

  test('网络先于鉴权：地区封锁带着鉴权字样仍归网络；纯鉴权错误归鉴权；超时优先', () => {
    expect(classifyProtocolFailure({ timedOut: false, haystack: 'Failed to authenticate. API Error: 403 Request not allowed' })).toBe('network-blocked');
    expect(classifyProtocolFailure({ timedOut: false, haystack: 'TypeError: fetch failed (ECONNREFUSED 10.0.0.1:443)' })).toBe('network-blocked');
    expect(classifyProtocolFailure({ timedOut: false, haystack: 'Invalid API key · Please run /login' })).toBe('auth-missing');
    expect(classifyProtocolFailure({ timedOut: false, haystack: 'Not logged in' })).toBe('auth-missing');
    expect(classifyProtocolFailure({ timedOut: true, haystack: 'rate limit exceeded' })).toBe('timeout');
  });
});
