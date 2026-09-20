import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

/**
 * 锁的是 CI 的一个真实漏洞：e2e 作业里网关或浏览器没起来、或管理员登录失败时，
 * 原先整套用例 `skipIf` 跳过、作业照绿——实机验收等于被悄悄关掉。
 * `CS_TEST_REQUIRE=e2e` 之后这两种情况都必须让进程失败。本用例不需要集群：探测的是必然连不上的地址。
 */
describe('CS_TEST_REQUIRE=e2e 时环境缺席不再退化成跳过', () => {
  const session = JSON.stringify(join(import.meta.dir, 'consoleSession.ts'));
  const script = `import { e2eAvailable } from ${session}; console.log('available=' + await e2eAvailable());`;
  const run = async (require: string) => {
    const child = Bun.spawn(['bun', '-e', script], {
      env: { ...process.env, CS_E2E_CONSOLE: 'http://127.0.0.1:1', CS_E2E_CDP_PORT: '1', CS_TEST_REQUIRE: require },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, err };
  };

  test('未点名：没有集群的机器上整套跳过，并说明缺的是什么', async () => {
    const result = await run('');
    expect(result.code).toBe(0);
    expect(result.out).toContain('available=false');
    expect(result.err).toContain('网关 http://127.0.0.1:1 没有应答');
  }, 30_000);

  test('点名 e2e：探测失败让进程失败，错误里写明缺的是网关还是浏览器', async () => {
    const result = await run('e2e');
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('CS_TEST_REQUIRE 要求能力「e2e」');
    expect(result.err).toContain('调试浏览器 127.0.0.1:1 没有应答');
  }, 30_000);
});
