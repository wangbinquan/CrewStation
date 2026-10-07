import { precondition } from '@crewstation/kernel';
import type { NativeDevelopmentLedgerStore } from '../../ports/nativeDevelopmentLedger';
import type { UsageTaskScope } from '../../ports/usageLedger';
import type { nativeDevelopmentWork } from './nativeDevelopmentWork';

/** Used after ordinary source EOF, including recovery when every source page has already been ACKed. */
export async function drainNativeDevelopmentWork(store: NativeDevelopmentLedgerStore,
  filter: { scope: UsageTaskScope; sourceId: string }, work: ReturnType<typeof nativeDevelopmentWork>) {
  let after: string | null = null;
  for (;;) {
    const page = await store.pendingNativeDevelopment(after, 100, filter);
    for (const item of page.items) {
      let prior: string | undefined;
      for (;;) {
        const result = await work(item);
        if (result.processed) break;
        const current = JSON.stringify([result.work.ordinal, result.work.index, result.work.visited, result.work.held]);
        if (result.work.blockedAtDependencies || !result.work.numericEof && prior === current)
          throw precondition('原生来源尚未达到完整数值与估值 EOF，不能宣告删除排空完成');
        prior = current;
      }
    }
    if (page.nextCursor === null) return;
    after = page.nextCursor;
  }
}
