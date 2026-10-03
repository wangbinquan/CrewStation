import type { Logger } from '@crewstation/kernel';
import type { ProvisioningProjectWork } from '../ports/projectWork';
import type { StartupTask } from './namespaceReapply';

/** A missing original Pod is not proof. The protected container source decides actual termination. */
export function projectWorkObserver(work: ProvisioningProjectWork, logger: Logger): StartupTask {
  let running = false, pending: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const tick = () => {
    if (!running || pending) return;
    pending = work.observe().catch(() => logger.warn('original provisioning callback observation unavailable')).finally(() => {
      pending = undefined;
      if (running) timer = setTimeout(tick, 5000);
    });
  };
  return { start: () => { if (running) return; running = true; tick(); }, stop: async () => { running = false; clearTimeout(timer); await pending; } };
}
