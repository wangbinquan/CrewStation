import type { BeforeStartMaterial, ComputeUsage, ProfileRevisionRef } from '@crewstation/contracts';
import { DEFAULT_COMPUTE_PROFILE } from '@crewstation/contracts';
import { notFound, precondition, validation } from '@crewstation/kernel';
import type { ComputeProfile, ProfileRevision } from '../domain/computeProfile';
import { availabilityOf } from '../domain/computeProfile';
import { pinnedReference, repositoryOf } from '../domain/imageReference';
import type { ProfileLaunchMaterial, ResolvedProfile } from '../api/moduleApi';
import type { AgentRuntimeUseCaseDeps } from './dependencies';

/**
 * 解析（RFC-006 §4.3）：default 在每次调用时解析（C17）；通用终端档位只能用于「＋ CLI」（C6）；
 * 停用、未测试、测试中、测试失败都不能起新 Agent（C7），原因写成管理员能处理的话。
 */
export function resolveProfileUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, cipher, registry } = deps;
  const pinned = (revision: ProfileRevision): string => pinnedReference(repositoryOf(revision.content.image, registry.layout), revision.imageDigest, registry.layout);
  const named = async (nameOrDefault: string | undefined): Promise<ComputeProfile | undefined> =>
    !nameOrDefault || nameOrDefault === DEFAULT_COMPUTE_PROFILE ? uow.read.profiles.getDefault() : uow.read.profiles.get(nameOrDefault);
  const materialFor = async (profile: ComputeProfile, revision: ProfileRevision, captureOutput: boolean): Promise<BeforeStartMaterial> => {
    const stored = await uow.read.credentials.list(profile.name);
    const secrets: Record<string, string> = {};
    for (const name of revision.content.secretNames) {
      const found = stored.find((c) => c.name === name);
      if (!found) throw precondition(`算力档位 ${profile.name} 的凭据 ${name} 尚未设置，请管理员在平台管理里补齐`, { code: 'profile_secret_missing', profile: profile.name, name });
      secrets[name] = await cipher.decrypt(found.cipherText);
    }
    const { steps, vars, configFile } = revision.content;
    return { profile: profile.name, revision: revision.revision, contentHash: revision.contentHash, steps, vars: { ...vars }, secrets, configFile, captureOutput };
  };
  return {
    pinned,
    materialFor,
    resolve: async (nameOrDefault: string | undefined, usage: ComputeUsage): Promise<ResolvedProfile> => {
      const profile = await named(nameOrDefault);
      if (!profile) {
        if (!nameOrDefault || nameOrDefault === DEFAULT_COMPUTE_PROFILE) throw precondition('平台尚未设置默认算力档位，请管理员在平台管理里设置', { code: 'no_default_profile' });
        throw validation(`算力档位 ${nameOrDefault} 不存在`, { code: 'profile_not_found', available: (await uow.read.profiles.list()).map((p) => p.name) });
      }
      if (profile.protocol === 'terminal' && usage !== 'cli') throw validation(`算力档位 ${profile.name} 是通用终端协议，只能用于「＋ CLI」`, { code: 'terminal_profile_not_allowed', profile: profile.name });
      const [revision, latest] = await Promise.all([uow.read.revisions.get(profile.name, profile.currentRevision), uow.read.tests.latestFor(profile.name, profile.currentRevision)]);
      if (!revision) throw notFound('档位修订', `${profile.name}@${profile.currentRevision}`);
      const availability = availabilityOf(profile, revision, latest);
      if (!availability.available) throw precondition(availability.reason ?? `算力档位 ${profile.name} 暂不可用`, { code: 'profile_unavailable', profile: profile.name, state: availability.state });
      return { name: profile.name, revision: revision.revision, protocol: profile.protocol, image: pinned(revision), ...(revision.content.taskProfile ? { taskProfile: revision.content.taskProfile } : {}) };
    },
    /** 已受理的启动按固定修订取材料：停用或改了当前修订都不影响它（停用只阻止新的受理）。 */
    launchMaterial: async (ref: ProfileRevisionRef): Promise<ProfileLaunchMaterial> => {
      const profile = await uow.read.profiles.get(ref.profile);
      const revision = profile ? await uow.read.revisions.get(ref.profile, ref.revision) : undefined;
      if (!profile || !revision) throw precondition(`算力档位 ${ref.profile} 的修订 ${ref.revision} 已不存在（档位可能已被删除），请重新选择档位`, { code: 'profile_revision_missing', ...ref });
      return {
        name: profile.name, revision: revision.revision, protocol: profile.protocol, image: pinned(revision), launch: revision.content.launch,
        beforeStart: await materialFor(profile, revision, false), ...(revision.content.taskProfile ? { taskProfile: revision.content.taskProfile } : {}),
      };
    },
    /** 发布校验用（§4.4）：只看存在性与协议，不看测试状态；default 解析到当前默认档位。 */
    lookupForRelease: async (nameOrDefault: string): Promise<{ name: string; terminalOnly: boolean } | undefined> => {
      const profile = await named(nameOrDefault);
      return profile ? { name: profile.name, terminalOnly: profile.protocol === 'terminal' } : undefined;
    },
    listNames: async (): Promise<string[]> => (await uow.read.profiles.list()).map((p) => p.name),
  };
}
