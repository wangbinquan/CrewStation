import type { Actor, ProjectId, RuntimeImageSecretVersion, RuntimeImageRevisionDto, RuntimeImageSource, RuntimeImageValidationTarget, RuntimeImageVersionDto, ServiceId, UserId } from '@crewstation/contracts';
import { TASKRUNNER_PROTOCOL_VERSION } from '@crewstation/contracts';
import { forbidden, precondition } from '@crewstation/kernel';
import type { RuntimeBuildIdentity, RuntimeBuildSource, RuntimeImagePlatformPorts, RuntimeImagePlatformSettings } from '../ports/runtimeImages';

const binding = (revision: RuntimeBuildSource): ServiceId => {
  if (revision.source.kind !== 'source') throw precondition('已有镜像不需要源码凭据');
  return revision.source.repositoryBindingId as ServiceId;
};
const digest = (value: unknown) => `sha256:${new Bun.CryptoHasher('sha256').update(JSON.stringify(value)).digest('hex')}`;

export function runtimeImagePlatformPorts(ports: RuntimeImagePlatformPorts, settings: RuntimeImagePlatformSettings) {
  const buildActor = async (build: RuntimeBuildIdentity): Promise<Actor> => ({ userId: build.createdBy as UserId, isAdmin: await ports.isAdmin(build.createdBy as UserId) });
  const pushHost = `registry-push.${settings.serviceDomain}`;
  const profile = async (projectId: string, ref: { profileId: string; revision: number }) => {
    const current = await ports.compute.resolveForProject(projectId as ProjectId, { kind: 'profile', profileId: ref.profileId }, 'cli');
    if (current.revision !== ref.revision) throw precondition('算力档位修订已变化，请选择当前修订并重新验证镜像');
    return ports.compute.launchMaterial(ref);
  };
  const authorize = async (actor: Actor, id: string, action: 'view' | 'develop' | 'manage') => { await ports.project.authorize(actor, id as ProjectId, action === 'manage' ? 'manage-production-config' : action); };
  return {
    authorizer: { authorize },
    sourceRepository: {
      resolve: (actor: Actor, projectId: string, id: string, ref: string) => ports.scm.resolveBuildSource(actor, projectId as ProjectId, id as ServiceId, ref),
      readFile: (id: string, sha: string, path: string) => ports.scm.readFile(id as ServiceId, sha, path),
    },
    bases: { resolve: async (actor: Actor, projectId: string | undefined, source: RuntimeImageSource) => {
      if (!actor.isAdmin) throw forbidden('只有平台管理员可以构建运行镜像');
      if (projectId) await authorize(actor, projectId, 'develop');
      if (source.usage === 'service') return undefined;
      if (source.usage === 'task' || source.kind === 'existing') return `${settings.registryBase}/${settings.baseImage.repository}:${settings.baseImage.tag}`;
      if (!source.baseProfile) throw precondition('Agent 镜像必须指定精确算力档位修订');
      return (await ports.compute.launchMaterial(source.baseProfile)).image;
    } },
    existingImageAccess: async (actor: Actor, projectId: string | undefined) => { if (!actor.isAdmin) throw forbidden('只有平台管理员可以登记运行镜像'); if (projectId) await authorize(actor, projectId, 'develop'); return { prefixes: ['runtime'], exact: [settings.baseImage.repository] }; },
    initializationSecrets: { render: async (projectId: string, stamps: readonly RuntimeImageSecretVersion[]) => {
      const values: Record<string, string> = {};
      for (const environment of ['development', 'production'] as const) {
        const selected = stamps.filter((s) => s.environment === environment).map(({ definitionId, itemId, version }) => ({ definitionId, itemId, version }));
        if (!selected.length) continue;
        const rendered = await ports.config.renderPinnedSecretDefinitions(projectId as ProjectId, environment, selected);
        for (const [key, value] of Object.entries(rendered)) values[`${environment}:${key}`] = value;
      }
      return values;
    } },
    validationContracts: { profileRevision: async (actor: Actor, projectId: string, profileId: string) => {
      await authorize(actor, projectId, 'develop');
      const resolved = await ports.compute.resolveForProject(projectId as ProjectId, { kind: 'profile', profileId }, 'cli');
      return { profileId: resolved.id, revision: resolved.revision };
    }, secretVersions: async (actor: Actor, projectId: string, revision: RuntimeImageRevisionDto) => {
      const stamps = [];
      for (const environment of ['development', 'production'] as const) {
        const ids = [...new Set(revision.initializer.secrets.filter((s) => s.environment === environment).map((s) => s.configDefinitionId))];
        if (ids.length) stamps.push(...(await ports.config.secretDefinitionVersions(actor, projectId as ProjectId, environment, ids)).map((stamp) => ({ ...stamp, environment })));
      }
      return stamps;
    }, fingerprint: async (_actor: Actor, projectId: string, _version: RuntimeImageVersionDto, _revision: RuntimeImageRevisionDto, target: RuntimeImageValidationTarget) => {
      const base = { runnerProtocol: TASKRUNNER_PROTOCOL_VERSION, runtimeImageInitializer: 1, taskImage: settings.taskImage };
      return digest(target.usage === 'agent' ? { ...base, profile: digest((await profile(projectId, target.profile)).beforeStart) } : base);
    } },
    buildContext: async (build: RuntimeBuildIdentity, revision: RuntimeBuildSource) => {
      const actor = await buildActor(build), sourceProjectId = revision.sourceProjectId ?? build.sourceProjectId ?? build.projectId;
      if (!sourceProjectId) throw precondition('构建缺少固定来源业务');
      if (!build.projectId && !actor.isAdmin) throw forbidden('构建提交者已失去平台管理权限');
      const project = build.projectId ? await ports.project.getProject(actor, build.projectId as ProjectId) : { namespace: settings.systemNamespace, slug: 'platform' };
      if (!project.namespace) throw precondition('平台构建命名空间未配置');
      const source = await ports.scm.resolveBuildSource(actor, sourceProjectId as ProjectId, binding(revision), revision.commitSha!);
      if (source.commitSha !== revision.commitSha) throw precondition('固定源码提交已不可用');
      return { namespace: project.namespace, slug: project.slug, repositoryUrl: source.httpUrl };
    },
    credentials: imageBuildCredentials(ports, settings, buildActor, pushHost),
    registry: { pullBase: settings.registryBase, pushHost: settings.registryPushHost, scheme: settings.registryScheme },
    builder: { clientImage: settings.builderImage, builderImage: 'docker.io/moby/buildkit:v0.33.0-rootless', registryBase: settings.registryBase, pushHost, pushInsecure: true,
      builderResources: { cpu: '500m', memory: '1Gi', ephemeralStorage: '4Gi' }, clientResources: { cpu: '100m', memory: '256Mi', ephemeralStorage: '1Gi' }, workspaceSize: '1Gi', cacheSize: '3Gi' },
    limits: { platformBuilds: 2, projectBuilds: 1, buildTimeoutSeconds: 1800, logRetentionSeconds: 7 * 86400, logMaxBytes: 4 * 1024 * 1024 },
  };
}

function imageBuildCredentials(ports: RuntimeImagePlatformPorts, settings: RuntimeImagePlatformSettings, actorOf: (build: RuntimeBuildIdentity) => Promise<Actor>, pushHost: string) {
  return {
    issueGit: async (build: RuntimeBuildIdentity, revision: RuntimeBuildSource) => {
      const sourceProjectId = revision.sourceProjectId ?? build.sourceProjectId ?? build.projectId;
      if (!sourceProjectId) throw precondition('构建缺少固定来源业务');
      const actor = await actorOf(build);
      if (!build.projectId && !actor.isAdmin) throw forbidden('构建提交者已失去平台管理权限');
      await ports.project.authorize(actor, sourceProjectId as ProjectId, 'develop');
      return ports.scm.issueBuildCredential(binding(revision), Math.min(120, Math.max(1, Math.ceil((Date.parse(build.deadline) - Date.now()) / 60000))));
    },
    revokeGit: (revision: RuntimeBuildSource, id: string) => ports.scm.revokeBuildCredential(binding(revision), id),
    push: async (build: RuntimeBuildIdentity, revision: RuntimeBuildSource) => {
      const repositories = revision.baseImage ? [revision.baseImage.slice(settings.registryBase.length + 1).split('@')[0]!] : [];
      if (revision.baseImage && !revision.baseImage.startsWith(`${settings.registryBase}/`)) throw precondition('底座仓库不合法');
      const issued = await ports.compute.issueBuildPushCredential({ projectId: build.projectId, buildId: build.id, expiresAt: build.deadline, pullRepositories: repositories });
      return { host: pushHost, username: issued.username, password: issued.password };
    },
    packages: async (build: RuntimeBuildIdentity, revision: RuntimeBuildSource) => {
      if (revision.source.kind !== 'source') return {};
      const sourceProjectId = revision.sourceProjectId ?? build.sourceProjectId ?? build.projectId;
      if (!sourceProjectId) throw precondition('构建缺少固定来源业务');
      const actor = await actorOf(build), values: Record<string, string> = {};
      for (const env of ['development', 'production'] as const) {
        const refs = revision.source.secrets.filter((s) => s.environment === env); if (!refs.length) continue;
        const selected = await ports.config.renderSecretDefinitions(actor, sourceProjectId as ProjectId, env, [...new Set(refs.map((s) => s.configDefinitionId))]);
        for (const ref of refs) values[ref.id] = selected[ref.configDefinitionId]!;
      }
      return values;
    },
  };
}
