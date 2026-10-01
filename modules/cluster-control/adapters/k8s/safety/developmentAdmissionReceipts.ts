import type { DevelopmentAdmissionReceipt } from '@crewstation/contracts';
import { DevelopmentAdmissionReceiptSchema } from '@crewstation/contracts';
import { conflict, jsonHash, precondition } from '@crewstation/kernel';

type Seed = Omit<DevelopmentAdmissionReceipt, 'secretUid'>;
interface Entry { readonly identity: string; receipt?: DevelopmentAdmissionReceipt; inFlight?: Promise<DevelopmentAdmissionReceipt>; unknown?: true }
export interface DevelopmentAdmissionReceiptBuffer {
  create(seed: Seed, work: () => Promise<DevelopmentAdmissionReceipt>, existing?: () => Promise<boolean>): Promise<DevelopmentAdmissionReceipt>;
  pending(): readonly DevelopmentAdmissionReceipt[];
  acknowledge(receipt: DevelopmentAdmissionReceipt): void;
}
function snapshot(receipt: DevelopmentAdmissionReceipt): DevelopmentAdmissionReceipt {
  const value = DevelopmentAdmissionReceiptSchema.parse(receipt);
  return Object.freeze({ ...value, consumer: Object.freeze(value.consumer), permit: Object.freeze(value.permit) });
}
/** Per writer instance; all 128 slots include in-flight/unknown creates and unconfirmed receipts. */
export function developmentAdmissionReceiptBuffer(): DevelopmentAdmissionReceiptBuffer {
  const entries = new Map<string, Entry>();
  return {
    create: async (seed, work, existing) => {
      const identity = jsonHash(seed), prior = entries.get(seed.consumer.id);
      if (prior) {
        if (prior.identity !== identity) throw conflict('原消费者的在途准入材料不可替换');
        if (prior.receipt) return snapshot(prior.receipt);
        if (prior.unknown) throw precondition('等待原实际创建回执，不能采用同名 Secret');
        return prior.inFlight!;
      }
      if (entries.size >= 128) throw precondition('原准入回执容量已满，尚未发起新的创建');
      const entry: Entry = { identity }; entries.set(seed.consumer.id, entry);
      const workResult = (async () => {
        let retainReservation = false;
        try {
          if (existing && await existing()) {
            retainReservation = true;
            throw precondition('等待原创建响应，不能从同名对象回填 UID');
          }
          retainReservation = true;
          const receipt = snapshot(await work()), { secretUid: _uid, ...actual } = receipt;
          if (jsonHash(actual) !== identity) throw conflict('实际创建回执不属于预留的原消费者材料');
          entry.receipt = receipt;
          return snapshot(receipt);
        } catch (error) {
          if (retainReservation) entry.unknown = true;
          else entries.delete(seed.consumer.id);
          throw error;
        }
        finally { delete entry.inFlight; }
      })();
      entry.inFlight = workResult;
      return workResult;
    },
    pending: () => Object.freeze([...entries.values()].flatMap((entry) => entry.receipt ? [snapshot(entry.receipt)] : [])),
    acknowledge: (raw) => {
      const receipt = snapshot(raw), entry = entries.get(receipt.consumer.id);
      if (!entry) return;
      if (!entry.receipt || jsonHash(entry.receipt) !== jsonHash(receipt)) throw conflict('不能清除未确认或其他 UID 的原准入回执');
      entries.delete(receipt.consumer.id);
    },
  };
}
