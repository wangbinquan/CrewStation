import type { AgentProtocol, ComputeProfileSelector, ComputeUsage, ProfileRevisionRef } from '@crewstation/contracts';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { newResourceId, precondition, validation } from '@crewstation/kernel';
import type { ComputeCatalog, ComputeLaunch, ResolvedCompute } from '../ports/platform';

export interface FakeProfile {
  id?: string;
  name: string;
  protocol: AgentProtocol;
  model?: string;
  taskProfile?: string;
  revision?: number;
  available?: boolean;
  isDefault?: boolean;
  secrets?: Record<string, string>;
}

const BINARY: Record<AgentProtocol, string> = { 'claude-code': '/usr/local/bin/claude', opencode: '/usr/local/bin/opencode', terminal: '/opt/tool/bin/tool' };
const fixtureIds = new Map<string, string>();
/** Test labels only identify fixture declarations; the fake public catalog still accepts UUIDs only. */
export function computeId(label: string): string { if (!fixtureIds.has(label)) fixtureIds.set(label, newResourceId()); return fixtureIds.get(label)!; }
export const computeSelector = (label: string): ComputeProfileSelector => label === 'default' ? { kind: 'default' } : { kind: 'profile', profileId: computeId(label) };

/**
 * 与 agent-runtime 同语义的假目录：default 解析、终端档位只进「＋ CLI」、不可用抛 precondition；按修订取材料并记录请求。
 * 修订不可变：受理时解析过的修订按当时内容留快照，之后改 FakeProfile 不影响按该修订取的材料。
 */
export function fakeComputeCatalog(profiles: () => FakeProfile[]): ComputeCatalog & { materials: ProfileRevisionRef[] } {
  const materials: ProfileRevisionRef[] = [];
  const snapshots = new Map<string, FakeProfile>();
  const resolved = (p: FakeProfile, revision = p.revision ?? 1): ResolvedCompute => ({
    id: p.id ?? computeId(p.name), name: p.name, revision, protocol: p.protocol, image: `registry.test/runtime/${p.name}@sha256:${'0'.repeat(64)}`, ...(p.taskProfile ? { taskProfile: p.taskProfile } : {}),
  });
  const find = (selector: ComputeProfileSelector | undefined) => (!selector || selector.kind === 'default' ? profiles().find((p) => p.isDefault) : profiles().find((p) => (p.id ?? computeId(p.name)) === selector.profileId));
  return {
    materials,
    resolve: async (selector: ComputeProfileSelector | undefined, usage: ComputeUsage) => {
      const p = find(selector);
      if (!p) {
        if (!selector || selector.kind === 'default') throw precondition('平台尚未设置默认算力档位，请管理员在平台管理里设置', { code: 'no_default_profile' });
        throw validation(`算力档位 ${selector.profileId} 不存在`, { code: 'profile_not_found', available: profiles().map((x) => x.id ?? computeId(x.name)) });
      }
      if (p.protocol === 'terminal' && usage !== 'cli') throw validation(`算力档位 ${p.name} 是通用终端协议，只能用于「＋ CLI」`, { code: 'terminal_profile_not_allowed' });
      if (p.available === false) throw precondition(`档位 ${p.name} 正在测试，通过后即可使用`, { code: 'profile_unavailable', profile: p.name, state: 'testing' });
      const key = `${p.id ?? computeId(p.name)}@${p.revision ?? 1}`;
      if (!snapshots.has(key)) snapshots.set(key, { ...p });
      return resolved(p);
    },
    launchMaterial: async (ref: ProfileRevisionRef): Promise<ComputeLaunch> => {
      materials.push(ref);
      const p = snapshots.get(`${ref.profileId}@${ref.revision}`) ?? profiles().find((x) => (x.id ?? computeId(x.name)) === ref.profileId);
      if (!p) throw precondition(`算力档位 ${ref.profileId} 的修订 ${ref.revision} 已不存在`, { code: 'profile_revision_missing' });
      const launch = LaunchSpecSchema.parse({ protocol: p.protocol, binaryPath: BINARY[p.protocol], ...(p.model && p.protocol !== 'terminal' ? { model: p.model } : {}) });
      return { ...resolved(p, ref.revision), launch, beforeStart: { profile: p.id ?? computeId(p.name), revision: ref.revision, contentHash: `h${ref.revision}`, steps: [], vars: {}, secrets: p.secrets ?? {}, configFile: { kind: 'none' }, captureOutput: false } };
    },
  };
}
