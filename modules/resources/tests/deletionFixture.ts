import type { ProjectDeletionContext, ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { ProjectDeletionTargetSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase } from '@crewstation/testkit';
import { createResourcesModule, resourcesMigrations } from '../wiring';
import type { ResourceDeletionPhysics } from '../api/projectDeletion';
import { PROJECT } from './fixtures';

export const TARGET = ProjectDeletionTargetSchema.parse({ id: PROJECT, slug: 'delete-fixture', name: '清理夹具', namespace: 'cs-demo', state: 'active', kind: 'DigitalWorker', revision: '1', prodHost: 'delete-fixture.apps.test', previewHost: 'delete-fixture.preview.test', serviceHost: 'delete-fixture.services.test' });
export function deletionControls(database: TestDatabase) {
  let generation = 1, allowed = true, waiting = false, stopped = false, purged = false, original: ProjectDeletionInventory;
  const operationId = newResourceId(), effects: string[] = [];
  const grant = async (context: ProjectDeletionContext) => { if (!allowed || context.operationId !== operationId || context.generation !== generation) throw precondition('清理许可失效'); };
  // 此有状态替身只验证台账屏障与阶段转发，不能当作实际存储释放证据。
  const done = (phase: string) => ({ kind: 'done' as const, evidence: { kind: 'physical' as const, digest: jsonHash({ phase }), description: '测试替身的原资源阶段回执', count: 1 } });
  const physics: ResourceDeletionPhysics = {
    inspect: async () => ({ participant: 'resources', revision: jsonHash({ fake: true }), complete: true, resources: [{ kind: 'fake-volume', id: 'original', identity: 'original-uid', count: purged ? 0 : 1 }], references: [], blockers: [] }),
    seal: async () => { effects.push('seal'); return { kind: 'done', evidence: { kind: 'metadata', digest: jsonHash('seal'), description: '测试替身的原实例保护确认', count: 1 } }; },
    stop: async () => { effects.push('stop'); if (waiting) return { kind: 'waiting', reason: '测试停止来源仍在等待' }; stopped = true; return done('stop'); },
    purge: async () => { if (!stopped) throw precondition('未停止'); effects.push('purge'); purged = true; return done('purge'); },
    prove: async () => { if (!purged) return { kind: 'waiting', reason: '测试物理源尚未归零' }; effects.push('prove'); return done('prove'); },
    verify: async () => { if (!purged) throw precondition('没有原物理证明'); effects.push('verify'); return done('verify'); },
  };
  const module = createResourcesModule({ db: database.db, quotas: { limitFor: async () => 10 }, authorizer: { projectAccess: async () => ({ operate: true }) }, isAdmin: async () => true, projectAvailable: async () => undefined });
  const owner = module.api.projectDeletion.owner(physics, grant);
  const plan = async () => { original = await owner.inspect(TARGET); original = { ...original, resources: [...original.resources].sort((a, b) => jsonHash(a).localeCompare(jsonHash(b))) }; return original; };
  const context = (phase: ProjectDeletionPhase, changed: Partial<ProjectDeletionContext> = {}): ProjectDeletionContext => ({ operationId, generation, target: TARGET, phase, confirmed: original, ...changed });
  return { module, owner, physics, operationId, grant, effects, plan, context, run: (phase: ProjectDeletionPhase, changed: Partial<ProjectDeletionContext> = {}) => owner.run(context(phase, changed)), wait: (value: boolean) => { waiting = value; }, revoke: () => { allowed = false; }, takeover: () => { generation++; } };
}
export async function deletionFixture() { const database = await createTestDatabase([resourcesMigrations]); return { database, ...deletionControls(database) }; }
