import type { ManifestKind } from '@crewstation/contracts';

/**
 * 接入容器的两种 Manifest kind（RFC-002）：管理空间里归「能力接入」；项目管理与租户空间只列 DigitalWorker（2026-09-24 裁定）。
 * 放在 shared：外壳按它决定接入项目页面的返回去向与左栏当前项。
 */
export const INTEGRATION_KINDS: readonly ManifestKind[] = ['APIProxy', 'EventProducer'];

export const isIntegrationKind = (kind: ManifestKind | undefined): boolean => kind !== undefined && INTEGRATION_KINDS.includes(kind);
