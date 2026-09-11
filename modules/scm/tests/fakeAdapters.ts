// 用例层与模块级测试共用的假适配器：内存仓储、假 GitLab、假 git、假模板与临时目录。
import type { Clock } from '@crewstation/kernel';
import { PlatformError, conflict, notFound } from '@crewstation/kernel';
import type { RepositoryBinding } from '../domain/repositoryBinding';
import type { SessionCredential } from '../domain/sessionCredential';
import type { GitLabGateway, RemoteBranch, RemoteProject, RemoteTag } from '../ports/gitLabGateway';
import type { GitRunner } from '../ports/gitRunner';
import type { ProjectAuthorizer } from '../ports/projectAuthorizer';
import type { ScmSettings } from '../ports/scmSettings';
import type { ScratchDirs } from '../ports/scratchDirs';
import type { TemplateSource } from '../ports/templateSource';
import type { RepositoryScope, UnitOfWork } from '../ports/unitOfWork';

export const TEST_SETTINGS: ScmSettings = {
  baseUrl: 'http://gitlab.test:8929',
  groupPath: 'crewstation',
  platformToken: 'glpat-platform-secret',
  platformBotName: 'CrewStation Bot',
  defaultBranch: 'main',
};

export function mutableClock(start = '2026-09-11T10:00:00.000Z'): Clock & { advanceMinutes(minutes: number): void } {
  let at = new Date(start);
  return { now: () => new Date(at), advanceMinutes: (minutes) => { at = new Date(at.getTime() + minutes * 60_000); } };
}

export interface FakeRemoteProject {
  project: RemoteProject;
  branches: Map<string, RemoteBranch>;
  tags: RemoteTag[];
  protectedPatterns: Set<string>;
  tokens: Map<string, { name: string; expiresOn: string; revoked: boolean }>;
}

export function fakeGitLab() {
  const projects = new Map<string, FakeRemoteProject>();
  const behind = new Map<string, number>();
  const calls: string[] = [];
  let nextProjectId = 100;
  let nextTokenId = 1;
  const get = (id: string): FakeRemoteProject => {
    const project = projects.get(id);
    if (!project) throw notFound('GitLab 项目', id);
    return project;
  };
  const add = (pathWithNamespace: string, id = String(nextProjectId++)): FakeRemoteProject => {
    const entry: FakeRemoteProject = { project: { id, pathWithNamespace, defaultBranch: 'main' }, branches: new Map(), tags: [], protectedPatterns: new Set(), tokens: new Map() };
    projects.set(id, entry);
    return entry;
  };
  const byPath = (pathWithNamespace: string): FakeRemoteProject | undefined => [...projects.values()].find((p) => p.project.pathWithNamespace === pathWithNamespace);
  const gateway: GitLabGateway = {
    findProject: async (path) => { calls.push(`findProject ${path}`); return byPath(path)?.project; },
    createProject: async ({ groupPath, slug }) => { calls.push(`createProject ${groupPath}/${slug}`); return add(`${groupPath}/${slug}`).project; },
    listBranches: async (id) => [...get(id).branches.values()],
    getBranch: async (id, name) => get(id).branches.get(name),
    listTags: async (id) => [...get(id).tags],
    readFile: async () => undefined,
    createTag: async (id, { name, ref }) => {
      const project = get(id);
      if (project.tags.some((t) => t.name === name)) throw conflict(`Tag ${name} already exists`);
      const tag: RemoteTag = { name, commitSha: ref, createdAt: '2026-09-11T00:00:00.000Z', protected: project.protectedPatterns.has('v*') && name.startsWith('v') };
      project.tags.push(tag);
      calls.push(`createTag ${name}`);
      return tag;
    },
    ensureTagProtection: async (id, pattern) => { calls.push(`protect ${pattern}`); get(id).protectedPatterns.add(pattern); },
    countCommitsBehind: async (id, { from, to }) => { get(id); calls.push(`compare ${from}..${to}`); return behind.get(`${from}..${to}`); },
    createAccessToken: async (id, { name, expiresOn }) => {
      const tokenId = String(nextTokenId++);
      get(id).tokens.set(tokenId, { name, expiresOn, revoked: false });
      calls.push(`createAccessToken ${name}`);
      return { id: tokenId, token: `glpat-fake-${tokenId}-${Bun.randomUUIDv7().replace(/-/g, '')}` };
    },
    revokeAccessToken: async (id, tokenId) => {
      const token = get(id).tokens.get(tokenId);
      if (token) token.revoked = true;
      calls.push(`revokeAccessToken ${tokenId}`);
    },
  };
  const setBranch = (id: string, name: string, headSha: string, isDefault = false): void => { get(id).branches.set(name, { name, headSha, isDefault }); };
  return { gateway, projects, calls, behind, add, get, byPath, setBranch };
}

/** 假 git：记录推送；地址对应到假 GitLab 里的项目时把分支写进去，模拟推送落地。 */
export function fakeGit(gitlab?: ReturnType<typeof fakeGitLab>) {
  const pushes: Array<{ kind: 'init' | 'push'; workdir: string; url: string; branch: string }> = [];
  let pendingFailures = 0;
  const sha = (n: number): string => n.toString(16).padStart(40, '0');
  const record = (kind: 'init' | 'push', input: { workdir: string; remoteUrlWithCredential: string; branch: string }): { commitSha: string } => {
    if (pendingFailures > 0) {
      pendingFailures -= 1;
      throw new PlatformError('unavailable', 'git push 失败（exit 128）：remote rejected');
    }
    pushes.push({ kind, workdir: input.workdir, url: input.remoteUrlWithCredential, branch: input.branch });
    const commitSha = sha(pushes.length);
    const path = new URL(input.remoteUrlWithCredential).pathname.replace(/^\//, '').replace(/\.git$/, '');
    const remote = gitlab?.byPath(path);
    if (remote) remote.branches.set(input.branch, { name: input.branch, headSha: commitSha, isDefault: input.branch === 'main' });
    return { commitSha };
  };
  const runner: GitRunner = {
    initAndPush: async (input) => record('init', input),
    pushBranch: async (input) => record('push', input),
    headSha: async () => sha(pushes.length),
  };
  return { runner, pushes, failNextPushes: (count: number) => { pendingFailures = count; } };
}

export function fakeTemplates(known: string[] = ['minimal-sample']) {
  const materialized: Array<{ templateName: string; targetDir: string }> = [];
  const source: TemplateSource = {
    materialize: async (templateName, targetDir) => {
      if (!known.includes(templateName)) throw notFound('模板', templateName);
      materialized.push({ templateName, targetDir });
    },
  };
  return { source, materialized };
}

export function fakeScratch() {
  const removed: string[] = [];
  let count = 0;
  const dirs: ScratchDirs = {
    create: async (prefix) => {
      count += 1;
      const path = `/scratch/${prefix}-${count}`;
      return { path, remove: async () => { removed.push(path); } };
    },
  };
  return { dirs, removed };
}

export function memoryUnitOfWork() {
  const bindings = new Map<string, RepositoryBinding>();
  const credentials = new Map<string, SessionCredential>();
  const scope: RepositoryScope = {
    bindings: {
      getByServiceId: async (serviceId) => bindings.get(serviceId),
      getByPath: async (path) => [...bindings.values()].find((b) => b.pathWithNamespace === path),
      upsert: async (binding) => { bindings.set(binding.serviceId, binding); },
    },
    credentials: {
      insert: async (credential) => { credentials.set(credential.id, credential); },
      getById: async (id) => credentials.get(id),
      listExpired: async (now) => [...credentials.values()].filter((c) => !c.revokedAt && c.expiresAt.getTime() <= now.getTime()),
      markRevoked: async (id, at) => {
        const credential = credentials.get(id);
        if (credential) credentials.set(id, { ...credential, revokedAt: at });
      },
    },
  };
  const uow: UnitOfWork = { read: scope, run: (fn) => fn(scope) };
  return { uow, bindings, credentials };
}

export function recordingAuthorizer(): ProjectAuthorizer & { calls: string[] } {
  const calls: string[] = [];
  return { calls, authorize: async (actor, projectId, action) => { calls.push(`${actor.userId}:${projectId}:${action}`); } };
}
