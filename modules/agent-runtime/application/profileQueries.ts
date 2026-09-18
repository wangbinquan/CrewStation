import type { Actor, ComputeProfileDetailDto, ComputeProfileList, ComputeProfileSummaryDto } from '@crewstation/contracts';
import { notFound } from '@crewstation/kernel';
import type { ComputeProfile, ProfileRevision } from '../domain/computeProfile';
import { availabilityOf } from '../domain/computeProfile';
import type { ProfileTest } from '../domain/profileTest';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { adminOnly, credentialStates, listItemOf } from './toDto';

export interface CurrentProfile { profile: ComputeProfile; revision: ProfileRevision; latest: ProfileTest | undefined }

/** 读路径：列表、详情与租户投影。详情不返回任何密钥原值或密文。 */
export function profileQueries(deps: AgentRuntimeUseCaseDeps) {
  const { uow, references } = deps;
  const current = async (profile: ComputeProfile): Promise<CurrentProfile> => {
    const [revision, latest] = await Promise.all([uow.read.revisions.get(profile.name, profile.currentRevision), uow.read.tests.latestFor(profile.name, profile.currentRevision)]);
    if (!revision) throw notFound('档位修订', `${profile.name}@${profile.currentRevision}`);
    return { profile, revision, latest };
  };
  const load = async (name: string): Promise<CurrentProfile> => {
    const profile = await uow.read.profiles.get(name);
    if (!profile) throw notFound('算力档位', name);
    return current(profile);
  };
  return {
    current, load,
    listProfiles: async (actor: Actor): Promise<ComputeProfileList> => {
      adminOnly(actor);
      const rows = await Promise.all((await uow.read.profiles.list()).map(current));
      return { items: rows.map(({ profile, revision, latest }) => listItemOf(profile, revision, latest)) };
    },
    getProfile: async (actor: Actor, name: string): Promise<ComputeProfileDetailDto> => {
      adminOnly(actor);
      const { profile, revision, latest } = await load(name);
      const [stored, referencedBy] = await Promise.all([uow.read.credentials.list(name), references.listReferencingProjects(name)]);
      return {
        ...listItemOf(profile, revision, latest), content: revision.content, contentHash: revision.contentHash,
        credentials: credentialStates(revision.content.secretNames, stored), referencedBy, createdBy: profile.createdBy, createdAt: profile.createdAt.toISOString(),
      };
    },
    /** 租户面投影：名字、说明、是否仅终端、是否默认与能否选用；不泄露镜像、二进制、模型与步骤（RFC-001、RFC-006）。 */
    listSummaries: async (): Promise<ComputeProfileSummaryDto[]> => {
      const rows = await Promise.all((await uow.read.profiles.list()).map(current));
      return rows.map(({ profile, revision, latest }) => {
        const { available, reason } = availabilityOf(profile, revision, latest);
        return { name: profile.name, description: profile.description, terminalOnly: profile.protocol === 'terminal', isDefault: profile.isDefault, available, ...(reason ? { reason } : {}) };
      });
    },
  };
}
