import type { AgentProtocol, ComputeUsage, ProfileRevisionRef } from '@crewstation/contracts';
import { LaunchSpecSchema } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import type { ComputeCatalog, ComputeLaunch, ResolvedCompute } from '../ports/platform';

export interface FakeProfile {
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

/**
 * 与 agent-runtime 同语义的假目录：default 解析、终端档位只进「＋ CLI」、不可用抛 precondition；按修订取材料并记录请求。
 * 修订不可变：受理时解析过的修订按当时内容留快照，之后改 FakeProfile 不影响按该修订取的材料。
 */
export function fakeComputeCatalog(profiles: () => FakeProfile[]): ComputeCatalog & { materials: ProfileRevisionRef[] } {
  const materials: ProfileRevisionRef[] = [];
  const snapshots = new Map<string, FakeProfile>();
  const resolved = (p: FakeProfile, revision = p.revision ?? 1): ResolvedCompute => ({
    name: p.name, revision, protocol: p.protocol, image: `registry.test/runtime/${p.name}@sha256:${'0'.repeat(64)}`, ...(p.taskProfile ? { taskProfile: p.taskProfile } : {}),
  });
  const find = (name: string | undefined) => (!name || name === 'default' ? profiles().find((p) => p.isDefault) : profiles().find((p) => p.name === name));
  return {
    materials,
    resolve: async (name: string | undefined, usage: ComputeUsage) => {
      const p = find(name);
      if (!p) {
        if (!name || name === 'default') throw precondition('平台尚未设置默认算力档位，请管理员在平台管理里设置', { code: 'no_default_profile' });
        throw validation(`算力档位 ${name} 不存在`, { code: 'profile_not_found', available: profiles().map((x) => x.name) });
      }
      if (p.protocol === 'terminal' && usage !== 'cli') throw validation(`算力档位 ${p.name} 是通用终端协议，只能用于「＋ CLI」`, { code: 'terminal_profile_not_allowed' });
      if (p.available === false) throw precondition(`档位 ${p.name} 正在测试，通过后即可使用`, { code: 'profile_unavailable', profile: p.name, state: 'testing' });
      const key = `${p.name}@${p.revision ?? 1}`;
      if (!snapshots.has(key)) snapshots.set(key, { ...p });
      return resolved(p);
    },
    launchMaterial: async (ref: ProfileRevisionRef): Promise<ComputeLaunch> => {
      materials.push(ref);
      const p = snapshots.get(`${ref.profile}@${ref.revision}`) ?? profiles().find((x) => x.name === ref.profile);
      if (!p) throw precondition(`算力档位 ${ref.profile} 的修订 ${ref.revision} 已不存在`, { code: 'profile_revision_missing' });
      const launch = LaunchSpecSchema.parse({ protocol: p.protocol, binaryPath: BINARY[p.protocol], ...(p.model && p.protocol !== 'terminal' ? { model: p.model } : {}) });
      return { ...resolved(p, ref.revision), launch, beforeStart: { profile: p.name, revision: ref.revision, contentHash: `h${ref.revision}`, steps: [], vars: {}, secrets: p.secrets ?? {}, configFile: { kind: 'none' }, captureOutput: false } };
    },
  };
}
