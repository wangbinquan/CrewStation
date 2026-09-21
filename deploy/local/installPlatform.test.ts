import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cs-initial-admin-'));
  roots.push(root);
  mkdirSync(join(root, 'deploy/local'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  writeFileSync(join(root, 'deploy/local/lib.sh'), '# test: cluster commands are stubbed\n');
  for (const name of ['install-platform.sh', 'admin-credentials.sh', 'initial-admin.sh', 'configure-metrics.ts']) {
    const source = join(import.meta.dir, name);
    if (existsSync(source)) copyFileSync(source, join(root, 'deploy/local', name));
  }
  const executable = (name: string, body: string) => {
    writeFileSync(join(root, name), `#!/bin/bash\nset -eu\n${body}\n`);
    chmodSync(join(root, name), 0o755);
  };
  executable('bin/kubectl', `
printf '%s\\n' "$*" >> "$TEST_ROOT/kubectl.log"
case "$*" in
  *postgres-credentials*) printf 'postgres://test:test@localhost/test' | base64 ;;
  *CS_SECRET_KEY*) printf 'test-secret' | base64 ;;
  *CS_BOOTSTRAP_TOKEN*) printf 'one-time-test-token' | base64 ;;
  *'get pod -l'*) echo auth-pod ;;
  *bootstrap-admin*) if [ "\${TEST_BOOTSTRAP_FAIL:-}" = 1 ]; then echo 'bootstrap failed: database unavailable' >&2; exit 1; fi ;;
  *'apply -f -'*) cat >/dev/null ;;
esac`);
  executable('bin/bun', `echo 'metrics configured'`);
  executable('bin/curl', `printf '{"mode":"%s"}' "\${TEST_MODE:-bootstrap}"`);
  executable('deploy/local/seed-catalog.sh', `touch "$TEST_ROOT/catalog-seeded"`);
  executable('deploy/local/install-dev-auth.sh', `touch "$TEST_ROOT/dev-auth-installed"`);
  return root;
}

async function install(root: string, overrides: Record<string, string> = {}) {
  const process = Bun.spawn(['bash', join(root, 'deploy/local/install-platform.sh')], {
    env: { PATH: `${root}/bin:${Bun.env.PATH}`, TEST_ROOT: root, SKIP_BUILD: '1', CS_SKIP_TASK_RUNTIME: '1', CS_SKIP_DEV_AUTH: '1', ...overrides },
    stdout: 'pipe', stderr: 'pipe',
  });
  const [code, out, err] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
  return { code, out, err, commands: existsSync(join(root, 'kubectl.log')) ? readFileSync(join(root, 'kubectl.log'), 'utf8') : err };
}

describe('首次安装必须交由用户创建管理员', () => {
  test('默认安装保持待初始化，给出链接，不产生未知初始口令', async () => {
    const root = fixture();
    const result = await install(root);
    expect(result.code).toBe(0);
    expect(result.commands).toContain('38-cluster-metrics.yaml');
    expect(result.commands).toContain('rollout status statefulset/prometheus');
    expect(result.commands).toContain('rollout status daemonset/cs-storage-probe');
    expect(result.commands).not.toContain('bootstrap-admin');
    expect(existsSync(join(root, '.local/admin.env'))).toBe(false);
    expect(existsSync(join(root, 'catalog-seeded'))).toBe(false);
    expect(result.out).toContain('/auth/bootstrap#token=one-time-test-token');
  });

  test('显式无人值守安装才创建管理员并播种，口令文件仅所有者可读写', async () => {
    const root = fixture();
    const result = await install(root, { CS_BOOTSTRAP_ADMIN: '1', CS_BOOTSTRAP_ADMIN_PASSWORD: 'chosen-test-password' });
    expect(result.code).toBe(0);
    expect(result.commands).toContain('bootstrap-admin');
    expect(readFileSync(join(root, '.local/admin.env'), 'utf8')).toContain('CS_BOOTSTRAP_ADMIN_PASSWORD=chosen-test-password');
    expect(statSync(join(root, '.local/admin.env')).mode & 0o777).toBe(0o600);
    expect(existsSync(join(root, 'catalog-seeded'))).toBe(true);
    expect(result.out).not.toContain('chosen-test-password');
  });

  test('已有管理员时不重建、不生成或覆盖凭据，缺少脚本口令也不影响安装', async () => {
    const root = fixture();
    const result = await install(root, { TEST_MODE: 'ready', CS_BOOTSTRAP_ADMIN: '1' });
    expect(result.code).toBe(0);
    expect(result.commands).not.toContain('bootstrap-admin');
    expect(existsSync(join(root, '.local/admin.env'))).toBe(false);
    expect(result.out).toContain('管理员已创建');
    expect(result.out).not.toContain('#token=');
  });

  test('已有账号且提供凭据时保留目录播种', async () => {
    const root = fixture();
    const result = await install(root, { TEST_MODE: 'ready', CS_ADMIN_USERNAME: 'my-admin', CS_ADMIN_PASSWORD: 'my-chosen-password' });
    expect(result.code).toBe(0);
    expect(result.commands).not.toContain('bootstrap-admin');
    expect(existsSync(join(root, 'catalog-seeded'))).toBe(true);
  });

  test('非交互创建失败必须中止，不能伪称管理员已经存在', async () => {
    const root = fixture();
    const result = await install(root, { CS_BOOTSTRAP_ADMIN: '1', TEST_BOOTSTRAP_FAIL: '1' });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('database unavailable');
    expect(result.out).not.toContain('管理员已存在');
    expect(existsSync(join(root, '.local/admin.env'))).toBe(false);
    expect(existsSync(join(root, 'catalog-seeded'))).toBe(false);
  });

  test('空库即使遗留脚本凭据也必须等待创建，后续目录和开发身份初始化不会绕过', async () => {
    const root = fixture();
    mkdirSync(join(root, '.local'));
    const oldCredentials = 'CS_BOOTSTRAP_ADMIN_USERNAME=old-admin\nCS_BOOTSTRAP_ADMIN_PASSWORD=old-test-password\n';
    writeFileSync(join(root, '.local/admin.env'), oldCredentials);
    const result = await install(root, { CS_SKIP_DEV_AUTH: '0' });
    expect(result.code).toBe(0);
    expect(result.commands).not.toContain('bootstrap-admin');
    expect(readFileSync(join(root, '.local/admin.env'), 'utf8')).toBe(oldCredentials);
    expect(existsSync(join(root, 'catalog-seeded'))).toBe(false);
    expect(existsSync(join(root, 'dev-auth-installed'))).toBe(false);
  });

  test('初始化状态异常就停止，不猜测已完成或尝试建号', async () => {
    const root = fixture();
    const result = await install(root, { TEST_MODE: 'unavailable', CS_BOOTSTRAP_ADMIN: '1' });
    expect(result.code).not.toBe(0);
    expect(result.err).toContain('无法读取初始化状态');
    expect(result.commands).not.toContain('bootstrap-admin');
  });
});
