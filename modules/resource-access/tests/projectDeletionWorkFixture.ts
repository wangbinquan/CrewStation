import { newResourceId } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import type { ResourceAccessDeletionFixture } from './projectDeletionFixture';
import type { ResourceAdapter } from '../ports/resources';

export async function applicationWorkFixture(f: ResourceAccessDeletionFixture, commitBeforeResponse = false) {
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; }), held = new Promise<void>((resolve) => { release = resolve; });
  const target = { resourceType: 'object-plan' as const, resourceId: newResourceId(), action: 'grant' as const };
  const receipt = { revision: 'r2', effect: '原领域分配事务已提交，实际供给由资源 owner 观察', applied: false };
  let committed = false, writes = 0;
  const adapter: ResourceAdapter = { resourceType: 'object-plan', list: async () => [], read: async () => ({ target, name: '测试目录', revision: 'r1', current: {}, fields: [], impact: [], owned: false, available: true }),
    apply: async () => { writes++; committed = commitBeforeResponse; entered(); await held; committed = true; return receipt; },
    recover: async () => committed ? receipt : undefined, observe: async () => ({ applied: true, effect: '测试领域已观察' }),
  };
  const application = f.application([adapter]);
  const change = await application.api.direct(f.admin, f.own.id, { target, expectedRevision: 'r1', values: {}, reason: '验证原在途应用退出', requestKey: newResourceId() });
  const running = application.runOnce(); await ready;
  return { application, change, running, release, writes: () => writes };
}
export async function waitForApplicationDatabase(f: ResourceAccessDeletionFixture, waitingFor: 'seal-wait' | 'work-finished') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await f.db.db.execute<{ ready: boolean }>(waitingFor === 'seal-wait'
      ? sql`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock(%') AS ready`
      : sql`SELECT NOT EXISTS(SELECT 1 FROM resource_access.deletion_work WHERE project_id=${f.own.id} AND state='running') AS ready`);
    if (row?.ready) return true;
  }
  return false;
}
