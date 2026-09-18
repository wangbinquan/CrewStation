import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// RFC-006 T3「删除项的源码层断言」：驱动不再绑定二进制，也不再按协议默认名或测试命令头兜底（C5）。
const ROOT = join(import.meta.dir, '..');
const sources = [...new Bun.Glob('**/*.ts').scanSync({ cwd: ROOT })].filter((path) => !path.startsWith('tests/') && !path.startsWith('node_modules/') && !path.endsWith('.test.ts'));

test('驱动源码里没有默认二进制名、命令头兜底与确定性假驱动', () => {
  expect(sources.length).toBeGreaterThan(20);
  expect(existsSync(join(ROOT, 'injection', 'spawnHead.ts'))).toBe(false);
  const forbidden = [/pickRuntimeHead/, /spawnHead/, /CLAUDE_BINARY/, /OPENCODE_BINARY/, /_DRIVER_NAME\b/, /\bstub\b/i, /\[\s*'(?:claude|opencode)'\s*\]/];
  const hits = sources.flatMap((path) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${path} ${pattern}`);
  });
  expect(hits).toEqual([]);
});
