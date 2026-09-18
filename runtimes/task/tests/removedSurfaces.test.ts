import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// RFC-006 T3「删除项的源码层断言」：删掉的面不能换个名字又长回来。
const ROOT = join(import.meta.dir, '..');
const sources = [...new Bun.Glob('src/**/*.ts').scanSync({ cwd: ROOT })].filter((path) => !path.endsWith('.test.ts'));

test('Runner 源码里不再有确定性假驱动、按名字注册的驱动表、部署配置的凭据文件与 hello 的旧能力字段', () => {
  expect(sources.length).toBeGreaterThan(20);
  for (const removed of ['src/agentEnvFile.ts', 'src/agents/stubDriver.ts', 'src/agents/registry.ts']) expect(existsSync(join(ROOT, removed))).toBe(false);
  const forbidden = [/\bstub\b/i, /CS_AGENT_ENV_FILE/, /agentEnvFile/, /agentRuntimeConfig/, /capabilities\.drivers/, /DriverRegistry/, /AgentRuntimeMaterial/];
  const hits = sources.flatMap((path) => {
    const text = readFileSync(join(ROOT, path), 'utf8');
    return forbidden.filter((pattern) => pattern.test(text)).map((pattern) => `${path} ${pattern}`);
  });
  expect(hits).toEqual([]);
});

test('Dockerfile 暴露稳定的 Runner 启动路径，缺省命令就是它（RFC-006 §7）', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  expect(dockerfile).not.toMatch(/\bstub\b/i);
  expect(dockerfile).toContain('> /opt/crewstation/bin/task-runner');
  expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m);
  expect(dockerfile).toMatch(/^CMD \["\/opt\/crewstation\/bin\/task-runner"\]$/m);
});
