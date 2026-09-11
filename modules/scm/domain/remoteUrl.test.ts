import { describe, expect, test } from 'bun:test';
import { credentialTemplate, scrubCredential, splitCredential, withCredential } from './remoteUrl';

describe('remoteUrl', () => {
  test('凭据进 userinfo 段，再拆出来后地址不含凭据', () => {
    const url = withCredential('http://gitlab.local:8929/crewstation/demo.git', 'crewstation', 'glpat-s3cret_x');
    expect(url).toBe('http://crewstation:glpat-s3cret_x@gitlab.local:8929/crewstation/demo.git');
    const split = splitCredential(url);
    expect(split.url).toBe('http://gitlab.local:8929/crewstation/demo.git');
    expect(split.credential).toEqual({ username: 'crewstation', password: 'glpat-s3cret_x' });
    expect(splitCredential('file:///tmp/remote.git').credential).toBeUndefined();
  });

  test('特殊字符往返一致；模板保留花括号占位', () => {
    const split = splitCredential(withCredential('http://h/g/p.git', 'u@x', 'p@ss:w/rd'));
    expect(split.credential).toEqual({ username: 'u@x', password: 'p@ss:w/rd' });
    expect(credentialTemplate('http://gitlab.local:8929/crewstation/demo.git', 'cs-session')).toBe('http://cs-session:{token}@gitlab.local:8929/crewstation/demo.git');
  });

  test('scrubCredential 抹掉明文与 URL 编码形态', () => {
    const credential = { username: 'u', password: 'p@ss/w' };
    expect(scrubCredential('fatal: p@ss/w and p%40ss%2Fw leaked', credential)).toBe('fatal: *** and *** leaked');
    expect(scrubCredential('nothing', undefined)).toBe('nothing');
  });
});
