import type { ManifestKind } from '@crewstation/contracts';

/**
 * 租户空间只列数字人（RFC-002）。接入容器（APIProxy／EventProducer）是管理员建的平台项目，
 * 归平台管理空间的「接入容器」页；过滤在服务端做，它们根本不进租户的响应。
 */
export const TENANT_KINDS: readonly ManifestKind[] = ['DigitalWorker'];
