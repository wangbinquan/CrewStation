import { storageControlUpdate } from '../domain/storageControl';
import { conflict, jsonHash, noopLogger, type Logger } from '@crewstation/kernel';
import type { BusinessProjectWork } from '../ports/deletion/work';
import type { ControlSnapshot, ExecutionControls } from '../ports/executionControl';
import type { StorageControlOutbox, StorageControlSink } from '../ports/storage/control';
import { storageControlAcknowledged } from '../domain/executionControl';

/** Every mutation waits for a durable data acknowledgement. The outbox recovers a lost response. */
export function storageSynchronizedControls(controls: ExecutionControls, outbox: StorageControlOutbox, sink: StorageControlSink, logger: Logger = noopLogger, work?: BusinessProjectWork): ExecutionControls & { syncPending(): Promise<number> } {
  const apply = async <T>(update: Parameters<StorageControlSink['apply']>[0], callback: () => Promise<T>) => work
    ? work.runService({ serviceId: update.serviceId, kind: 'lifecycle', reference: update.serviceId, inputDigest: jsonHash(update) }, callback) : callback();
  const synchronize = async <T extends ControlSnapshot>(value: T): Promise<T> => {
    if (!value.control || storageControlAcknowledged(value.control)) return value;
    const update = storageControlUpdate(value.control);
    const acknowledged = await apply(update, async () => {
      if (!await (work ? work.effect(() => sink.apply(update)) : sink.apply(update))) throw conflict('对象写入控制已被较新版本取代', { code: 'storage_control_superseded' });
      return outbox.acknowledge(update);
    });
    if (!acknowledged) throw conflict('执行控制在确认对象写入权限时已变化，请重试', { code: 'storage_control_superseded' });
    return { ...value, ...acknowledged };
  };
  return {
    ...controls,
    quiescent: async (id) => { const { control } = await controls.read(id); return (!control || storageControlAcknowledged(control)) && await controls.quiescent(id); },
    claim: async (...args) => synchronize(await controls.claim(...args)), renew: async (...args) => synchronize(await controls.renew(...args)),
    release: async (...args) => synchronize(await controls.release(...args)), activate: async (...args) => synchronize(await controls.activate(...args)),
    freeze: async (...args) => synchronize(await controls.freeze(...args)), handoffReady: async (...args) => synchronize(await controls.handoffReady(...args)),
    routeObserved: async (...args) => synchronize(await controls.routeObserved(...args)),
    freezeMigration: async (...args) => synchronize(await controls.freezeMigration(...args)), migrationReady: async (...args) => synchronize(await controls.migrationReady(...args)),
    syncPending: async () => {
      let count = 0;
      for (const update of await outbox.pending(100)) {
        try { if (await apply(update, async () => await (work ? work.effect(() => sink.apply(update)) : sink.apply(update)) && await outbox.acknowledge(update))) count++; }
        catch { logger.warn('object storage control acknowledgement pending', { serviceId: update.serviceId, controlVersion: update.controlVersion }); }
      }
      return count;
    },
  };
}
