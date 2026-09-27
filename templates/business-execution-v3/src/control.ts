import { Platform, type Control, type Fence } from './client';
import { Store } from './store';

const root = '/v3/business-execution/control';
/** Each instance competes through the platform. A preview's physical slot name never grants authority. */
export class Controller {
  readonly instanceId = Bun.randomUUIDv7();
  current: Control | undefined;
  private running = false;
  constructor(readonly platform: Platform, readonly store: Store) {}
  get stopAuthority(): { operationId: string; epoch: number } {
    const c = this.current;
    if (!c?.migration || c.phase !== 'frozen') throw new Error('此实例没有迁移排空权限');
    return { operationId: c.migration.operationId, epoch: c.epoch };
  }
  get fence(): Fence {
    const c = this.current;
    if (!c || c.phase !== 'active' || c.leaseOwner !== this.instanceId || !c.leaseId || !c.leaseExpiresAt || Date.parse(c.leaseExpiresAt) <= Date.now()) throw new Error('此实例当前没有执行权');
    return { epoch: c.epoch, leaseId: c.leaseId, instanceId: this.instanceId };
  }
  async tick(): Promise<void> {
    if (this.running || !await this.store.ready()) return;
    this.running = true;
    try { await this.reconcile(); }
    catch { this.current = undefined; /* No orphan recovery or shutdown writes on authority loss. */ }
    finally { this.running = false; }
  }
  private async reconcile(): Promise<void> {
    let control = await this.platform.call<Control>(root);
    if (control.migration) {
      await this.store.prepare(control.epoch, null, 'frozen', null);
      this.current = await this.platform.call<Control>(`${root}/migrations/${control.migration.operationId}/ready`, {
        operationId: control.migration.operationId, expectedEpoch: control.epoch, preparationDigest: digest({ epoch: control.epoch, phase: 'frozen' }),
      }); return;
    }
    control = await this.platform.call<Control>(`${root}/claim`, { instanceId: this.instanceId });
    if (!control.leaseId || !control.leaseExpiresAt) throw new Error('平台未授予租约');
    const lease = { expectedEpoch: control.epoch, leaseId: control.leaseId, instanceId: this.instanceId };
    control = await this.platform.call<Control>(`${root}/renew`, lease);
    const preparationDigest = digest({ epoch: control.epoch, instanceId: this.instanceId, taskContractVersion: 'sample-v1' });
    await this.store.prepare(control.epoch, this.instanceId, 'preparing', control.leaseExpiresAt);
    if (control.operationId) await this.platform.call(`${root}/handoffs/${control.operationId}/ready`, {
      ...lease, operationId: control.operationId, preparationDigest, acceptedTaskContractVersions: ['sample-v1'],
    });
    control = await this.platform.call<Control>(`${root}/activate`, { ...lease, preparationDigest });
    await this.store.prepare(control.epoch, this.instanceId, 'active', control.leaseExpiresAt);
    this.current = control;
  }
}
export const digest = (value: unknown) => new Bun.CryptoHasher('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
