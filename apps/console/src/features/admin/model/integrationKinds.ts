import type { ManifestKind } from '@crewstation/contracts';

/** 接入容器的两种 Manifest kind（RFC-002）：管理空间列它们，租户空间只列 DigitalWorker。 */
export const INTEGRATION_KINDS: readonly ManifestKind[] = ['APIProxy', 'EventProducer'];
