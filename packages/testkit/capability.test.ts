import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { requiredTestCapabilities, resolveCapability } from './capability';

describe('CS_TEST_REQUIRE 解析', () => {
  test('未设置或为空时不要求任何能力', () => {
    expect([...requiredTestCapabilities({})]).toEqual([]);
    expect([...requiredTestCapabilities({ CS_TEST_REQUIRE: ' , ' })]).toEqual([]);
  });

  test('逗号分隔，容忍空白与重复', () => {
    expect([...requiredTestCapabilities({ CS_TEST_REQUIRE: 'database, e2e,database' })]).toEqual(['database', 'e2e']);
  });

  // 拼错的能力名如果被忽略，等于悄悄关掉这道闸：CI 以为自己要求了数据库，实际什么也没要求。
  test('未知能力名直接报错并列出可用名字', () => {
    expect(() => requiredTestCapabilities({ CS_TEST_REQUIRE: 'databse' })).toThrow('未知能力 databse');
    expect(() => requiredTestCapabilities({ CS_TEST_REQUIRE: 'databse' })).toThrow('database、gitlab、e2e');
  });
});

describe('resolveCapability', () => {
  const warn = spyOn(console, 'warn').mockImplementation(() => {});
  afterEach(() => warn.mockClear());

  test('可用时放行，不打告警', () => {
    expect(resolveCapability('database', true, '不会用到', { CS_TEST_REQUIRE: 'database' })).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test('不可用且未被要求：返回 false 并说明跳过原因，不是静默通过', () => {
    expect(resolveCapability('gitlab', false, '未找到 .local/gitlab.env', { CS_TEST_REQUIRE: 'database' })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('未找到 .local/gitlab.env');
  });

  test('不可用但被点名：抛错并带上探测到的原因', () => {
    expect(() => resolveCapability('database', false, '连接被拒绝', { CS_TEST_REQUIRE: 'database' })).toThrow('不允许跳过');
    expect(() => resolveCapability('database', false, '连接被拒绝', { CS_TEST_REQUIRE: 'database' })).toThrow('连接被拒绝');
  });
});

/**
 * 锁的是真实故障形态：CI 的 PostgreSQL 服务没起来时，约 60 个 `describe.skipIf(!available)` 整组跳过、
 * check 作业照绿。这里在子进程里用一个必然连不上的地址走真实探测，确认被点名时进程非零退出。
 */
describe('testDatabaseAvailable 在子进程里的真实行为', () => {
  const script = `import { testDatabaseAvailable } from ${JSON.stringify(join(import.meta.dir, 'database.ts'))}; console.log('available=' + await testDatabaseAvailable());`;
  const run = async (require: string) => {
    const child = Bun.spawn(['bun', '-e', script], {
      env: { ...process.env, CS_TEST_DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/absent', CS_TEST_REQUIRE: require },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, err };
  };

  test('未点名 database：探测失败只是跳过', async () => {
    const result = await run('');
    expect(result.out).toContain('available=false');
    expect(result.code).toBe(0);
  }, 30_000);

  test('点名 database：探测失败让进程失败，错误里有地址与原因', async () => {
    const result = await run('database');
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('CS_TEST_REQUIRE 要求能力「database」');
    expect(result.err).toContain('127.0.0.1:1');
  }, 30_000);
});
