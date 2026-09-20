// 对本机测试 GitLab（docker 容器 aw-local-gitlab）的集成测试：只有 .local/gitlab.env 存在时运行。
// 创建 crewstation-test/<随机 slug>，验证建仓 → 幂等重跑 → 冲突 → 标签保护与打标 → 分支落后数 → 会话凭据，最后删除该项目。
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Actor, ProjectId, ServiceId, UserId } from '@crewstation/contracts';
import { RepositoryBindingDtoSchema } from '@crewstation/contracts';
import type { GitLabClient } from '@crewstation/gitlab-client';
import { createGitLabClient } from '@crewstation/gitlab-client';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, resolveCapability, testDatabaseAvailable } from '@crewstation/testkit';
import { bunGitRunner } from '../adapters/git/bunGitRunner';
import { DEFAULT_CREDENTIAL_USERNAME, PLATFORM_PUSH_USERNAME, credentialTemplate, splitCredential, withCredential } from '../domain/remoteUrl';
import { hashToken } from '../domain/sessionCredential';
import type { ScmModule } from '../wiring';
import { createScmModule, scmMigrations } from '../wiring';
import { mutableClock } from './fakeAdapters';

const ENV_FILE = resolve(import.meta.dir, '..', '..', '..', '.local', 'gitlab.env');
const GROUP = 'crewstation-test';
const TEMPLATE = 'integration-sample';
const TIMEOUT = 120_000;

function loadGitLabEnv(): { url: string; token: string } | undefined {
  if (!existsSync(ENV_FILE)) return undefined;
  const vars = new Map<string, string>();
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const at = line.indexOf('=');
    if (at > 0 && !line.startsWith('#')) vars.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
  }
  const url = vars.get('CS_TEST_GITLAB_URL');
  const token = vars.get('CS_TEST_GITLAB_TOKEN');
  return url && token ? { url, token } : undefined;
}

const gitlabEnv = loadGitLabEnv();
const dbAvailable = await testDatabaseAvailable();
// 能力闸门：CS_TEST_REQUIRE 点名 gitlab 的运行里缺 .local/gitlab.env 是故障，不是「没环境」。
const gitlabAvailable = resolveCapability('gitlab', gitlabEnv !== undefined, '未找到 .local/gitlab.env（CS_TEST_GITLAB_URL／CS_TEST_GITLAB_TOKEN）');
const available = gitlabAvailable && dbAvailable;
if (gitlabAvailable && !dbAvailable) console.warn('[scm] .local/gitlab.env 存在但测试数据库不可达，GitLab 集成测试跳过');

const hex = () => Bun.randomUUIDv7().replace(/-/g, '');
const slug = `it-${hex().slice(-8)}`;
const path = `${GROUP}/${slug}`;
const serviceId = `svc_${hex()}` as ServiceId;
const otherServiceId = `svc_${hex()}` as ServiceId;
const projectId = `prj_${hex()}` as ProjectId;
const actor: Actor = { userId: `usr_${'a'.repeat(32)}` as UserId, isAdmin: false };
const clock = mutableClock(new Date().toISOString());

let tdb: TestDatabase;
let scm: ScmModule;
let client: GitLabClient;
let templatesRoot: string;
let workRoot: string;
let remoteProjectId: string | undefined;
let httpUrl = '';
let firstCreatedAt = '';

/** 测试自己的 git 调用（本地提交、建分支）；凭据只经环境变量注入，与适配器同一做法。 */
async function git(cwd: string, args: string[], token?: string): Promise<string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com' };
  if (token) Object.assign(env, { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.extraHeader', GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x:${token}`).toString('base64')}` });
  const proc = Bun.spawn(['git', '-c', 'credential.helper=', ...args], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`git ${args[0]} exit ${code}: ${token ? stderr.split(token).join('***') : stderr}`);
  return stdout.trim();
}

/**
 * GitLab 对 `GET /repository/branches` 的响应按（项目、用户、参数）缓存约 30 秒，单个分支查询不缓存；
 * 推送后列表里的 HEAD 会滞后，轮询直到列表反映新 HEAD，并记录观察到的滞后时间。
 */
async function eventually<T>(read: () => Promise<T>, settled: (value: T) => boolean, timeoutMs = 60_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    const elapsed = Date.now() - started;
    if (settled(value)) {
      if (elapsed > 1_000) console.log(`[scm] GitLab 分支列表在推送后约 ${Math.round(elapsed / 1000)} 秒才反映新 HEAD（列表接口有 30 秒响应缓存）`);
      return value;
    }
    if (elapsed > timeoutMs) return value;
    await Bun.sleep(500);
  }
}

beforeAll(async () => {
  if (!available || !gitlabEnv) return;
  client = createGitLabClient({ baseUrl: gitlabEnv.url, token: gitlabEnv.token });
  templatesRoot = await mkdtemp(join(tmpdir(), 'cs-scm-templates-'));
  await mkdir(join(templatesRoot, TEMPLATE, 'src'), { recursive: true });
  await writeFile(join(templatesRoot, TEMPLATE, 'README.md'), `# ${TEMPLATE}\n`);
  await writeFile(join(templatesRoot, TEMPLATE, 'src', 'index.ts'), 'export const hello = "crewstation";\n');
  workRoot = await mkdtemp(join(tmpdir(), 'cs-scm-it-'));
  tdb = await createTestDatabase([scmMigrations]);
  scm = createScmModule({
    db: tdb.db,
    project: { isAdmin: async () => false, authorize: async () => 'owner' },
    templatesRoot,
    clock,
    settings: { baseUrl: gitlabEnv.url, groupPath: GROUP, platformToken: gitlabEnv.token, platformBotName: 'CrewStation Bot', platformBotEmail: 'bot@crewstation.local', defaultBranch: 'main' },
  });
});

afterAll(async () => {
  if (remoteProjectId) {
    // GitLab 19 先把项目标记删除并改名为 `<path>-deletion_scheduled-<id>`；再按新路径永久清除，避免测试项目堆到延迟期结束。
    await client.deleteProject(remoteProjectId);
    const scheduled = await client.getProject(remoteProjectId).catch(() => undefined);
    const removed = scheduled
      ? await client.deleteProject(remoteProjectId, { permanentlyRemove: true, fullPath: scheduled.pathWithNamespace }).then(() => true, () => false)
      : false;
    console.log(`[scm] 已删除 GitLab 测试项目 ${path}（id ${remoteProjectId}，${removed ? '已永久清除' : '已标记删除'}）`);
  }
  await tdb?.drop();
  for (const dir of [templatesRoot, workRoot]) if (dir) await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!available)('scm × 本机 GitLab', () => {
  test('建仓：在 crewstation-test 组建项目、推模板首个提交、默认分支 main', async () => {
    expect((await client.getGroup(GROUP)).fullPath).toBe(GROUP);
    const dto = await scm.api.ensureRepository(serviceId, projectId, { slug, templateName: TEMPLATE });
    remoteProjectId = dto.remoteProjectId;
    httpUrl = dto.httpUrl;
    firstCreatedAt = dto.createdAt;
    expect(RepositoryBindingDtoSchema.parse(dto)).toMatchObject({ state: 'ready', pathWithNamespace: path, httpUrl: `${gitlabEnv?.url}/${path}.git`, defaultBranch: 'main' });
    const remote = await client.getProject(path);
    expect(String(remote.id)).toBe(remoteProjectId);
    expect(remote.defaultBranch).toBe('main');
    expect(remote.visibility).toBe('private');
    const tree = await client.getRepositoryTree(remote.id, '', { recursive: true });
    expect(tree.filter((e) => e.type === 'blob').map((e) => e.path).sort()).toEqual(['README.md', 'src/index.ts']);
    const main = await client.getBranch(remote.id, 'main');
    expect(main.default).toBe(true);
    expect(main.commit.authorName).toBe('CrewStation Bot');
    expect(main.commit.title).toBe(`chore: initialize from template ${TEMPLATE}`);
    console.log(`[scm] 已在 GitLab 创建测试项目 ${path}（id ${remoteProjectId}，main=${main.commit.shortId}）`);
  }, TIMEOUT);

  test('幂等重跑返回同一绑定；同路径的另一服务 → conflict，不接管', async () => {
    const again = await scm.api.ensureRepository(serviceId, projectId, { slug, templateName: TEMPLATE });
    expect(again.remoteProjectId).toBe(remoteProjectId ?? '');
    expect(again.createdAt).toBe(firstCreatedAt);
    await expect(scm.api.ensureRepository(otherServiceId, projectId, { slug, templateName: TEMPLATE })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(scm.api.getBinding(actor, otherServiceId)).rejects.toMatchObject({ kind: 'not_found' });
    expect(String((await client.getProject(path)).id)).toBe(remoteProjectId ?? '');
  }, TIMEOUT);

  test('v* 受保护且只有维护者能建；平台打标 minor→v0.1.0、patch→v0.1.1，重复显式标签 conflict', async () => {
    const id = remoteProjectId ?? '';
    const protection = (await client.listProtectedTags(id)).find((t) => t.name === 'v*');
    expect(protection?.createAccessLevels.map((l) => l.accessLevel)).toEqual([40]);
    const main = await client.getBranch(id, 'main');
    await expect(scm.api.createReleaseTag(serviceId, { branch: 'main', bump: 'minor', expectedCommitSha: 'f'.repeat(40) })).rejects.toMatchObject({ kind: 'conflict', details: { actual: main.commit.id } });
    expect((await scm.api.listTags(actor, serviceId))).toHaveLength(0);
    expect(await scm.api.createReleaseTag(serviceId, { branch: 'main', bump: 'minor', expectedCommitSha: main.commit.id })).toEqual({ tag: 'v0.1.0', commitSha: main.commit.id });
    expect((await scm.api.createReleaseTag(serviceId, { branch: 'main', bump: 'patch' })).tag).toBe('v0.1.1');
    await expect(scm.api.createReleaseTag(serviceId, { branch: 'main', tag: 'v0.1.1' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(scm.api.createReleaseTag(serviceId, { branch: 'no-such-branch', bump: 'patch' })).rejects.toMatchObject({ kind: 'not_found' });
    const tags = await scm.api.listTags(actor, serviceId);
    expect(tags.map((t) => [t.name, t.commitSha, t.protected]).sort()).toEqual([['v0.1.0', main.commit.id, true], ['v0.1.1', main.commit.id, true]]);
    for (const tag of tags) expect(() => new Date(tag.createdAt).toISOString()).not.toThrow();
  }, TIMEOUT);

  test('分支落后数：孤立 feature 分支落后 main 1 个提交；经平台代推第二个提交后计数随之变化', async () => {
    const id = remoteProjectId ?? '';
    const runner = bunGitRunner({ authorName: 'Dev', authorEmail: 'dev@example.com' });
    const workdir = join(workRoot, 'feature');
    await mkdir(workdir);
    await writeFile(join(workdir, 'FEATURE.md'), 'feature\n');
    const pushUrl = withCredential(httpUrl, PLATFORM_PUSH_USERNAME, gitlabEnv?.token ?? '');
    const { commitSha: featureSha } = await runner.initAndPush({ workdir, remoteUrlWithCredential: pushUrl, branch: 'feature', message: 'feat: first' });
    const mainSha = (await client.getBranch(id, 'main')).commit.id;
    let branches = await eventually(() => scm.api.listBranches(actor, serviceId, { previewSha: mainSha }), (list) => list.some((b) => b.name === 'feature' && b.headSha === featureSha));
    const byName = (name: string) => branches.find((b) => b.name === name);
    expect(byName('main')).toEqual({ name: 'main', headSha: mainSha, isDefault: true, behindPreview: 0, behindProd: null });
    expect(byName('feature')).toEqual({ name: 'feature', headSha: featureSha, isDefault: false, behindPreview: 1, behindProd: null });
    await writeFile(join(workdir, 'MORE.md'), 'more\n');
    await git(workdir, ['add', '-A']);
    await git(workdir, ['commit', '-q', '-m', 'feat: second']);
    const pushed = await scm.api.pushBranch(serviceId, workdir, 'feature');
    expect(pushed.commitSha).toBe(await runner.headSha(workdir, 'feature'));
    expect(pushed.commitSha).not.toBe(featureSha);
    expect((await client.getBranch(id, 'feature')).commit.id).toBe(pushed.commitSha);
    branches = await eventually(() => scm.api.listBranches(actor, serviceId, { previewSha: pushed.commitSha, prodSha: mainSha }), (list) => list.some((b) => b.name === 'feature' && b.headSha === pushed.commitSha));
    expect(byName('main')).toMatchObject({ behindPreview: 2, behindProd: 0 });
    expect(byName('feature')).toMatchObject({ headSha: pushed.commitSha, behindPreview: 0, behindProd: 1 });
    const unknown = await scm.api.listBranches(actor, serviceId, { previewSha: 'f'.repeat(40) });
    expect(unknown.map((b) => b.behindPreview)).toEqual([null, null]);
  }, TIMEOUT);

  test('会话凭据：开发者级令牌能推普通分支、不能建 v* 标签；库里只有哈希；到期撤销后失效', async () => {
    const id = remoteProjectId ?? '';
    const issued = await scm.api.issueSessionCredential(serviceId, 30);
    expect(issued.httpUrlWithCredentialTemplate).toBe(credentialTemplate(httpUrl, DEFAULT_CREDENTIAL_USERNAME));
    expect(new Date(issued.expiresAt).getTime()).toBe(clock.now().getTime() + 30 * 60_000);
    const rows = (await tdb.db.execute('SELECT token_hash, remote_token_id, revoked_at FROM scm.session_credentials')) as unknown as Array<{ token_hash: string; remote_token_id: string; revoked_at: Date | null }>;
    expect(rows).toEqual([{ token_hash: hashToken(issued.token), remote_token_id: rows[0]?.remote_token_id ?? '', revoked_at: null }]);
    expect(JSON.stringify(rows)).not.toContain(issued.token);
    const sessionUrl = issued.httpUrlWithCredentialTemplate.replace('{token}', issued.token);
    expect(splitCredential(sessionUrl)).toEqual({ url: httpUrl, credential: { username: DEFAULT_CREDENTIAL_USERNAME, password: issued.token } });
    const runner = bunGitRunner({ authorName: 'Dev', authorEmail: 'dev@example.com' });
    const workdir = join(workRoot, 'feature');
    await git(workdir, ['branch', 'session-check', 'feature']);
    const { commitSha } = await runner.pushBranch({ workdir, remoteUrlWithCredential: sessionUrl, branch: 'session-check' });
    expect((await client.getBranch(id, 'session-check')).commit.id).toBe(commitSha);
    await git(workdir, ['tag', 'v9.9.9', 'session-check']);
    const tagPush = git(workdir, ['push', '-q', httpUrl, 'refs/tags/v9.9.9:refs/tags/v9.9.9'], issued.token);
    await expect(tagPush).rejects.toThrow(/protected/i);
    expect((await client.listTags(id)).map((t) => t.name)).not.toContain('v9.9.9');
    clock.advanceMinutes(31);
    expect(await scm.api.revokeExpiredCredentials()).toBe(1);
    await writeFile(join(workdir, 'AFTER.md'), 'after\n');
    await git(workdir, ['add', '-A']);
    await git(workdir, ['commit', '-q', '-m', 'after revoke']);
    await git(workdir, ['branch', '-f', 'session-check', 'feature']);
    try {
      await runner.pushBranch({ workdir, remoteUrlWithCredential: sessionUrl, branch: 'session-check' });
      throw new Error('revoked credential must not push');
    } catch (error) {
      expect((error as { kind?: string }).kind).toBe('unavailable');
      expect((error as Error).message).not.toContain(issued.token);
    }
  }, TIMEOUT);
});
