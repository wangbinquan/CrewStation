import type { ManifestKind, ProjectId, ServiceId } from '@crewstation/contracts';
import type { CatalogEntryState } from './apiOperation';

/**
 * 目录中的一个代理：接入容器（kind APIProxy，名字来自 Manifest `spec.proxy`），
 * 或数字人以 `apis.exposes` 登记的自有 API（kind DigitalWorker，名字即服务 slug）。
 * 同名代理只能属于一个服务；请求经服务域前缀 `/api/<proxy>/` 路由。
 */
export interface ApiProxy {
  readonly id: string;
  readonly name: string;
  /** Protocol route code; it is not the resource's identity or display name. */
  readonly proxy: string;
  readonly projectId: ProjectId;
  readonly serviceId: ServiceId;
  readonly kind: ManifestKind;
  /** 只有接入容器有上游连接；凭据由 cs-auth 按需下发，目录只记名字。 */
  readonly upstreamConnection?: string;
  /** 原始 OpenAPI 文档（已解析为 JSON 对象），裁剪时的输入。 */
  readonly document: unknown;
  readonly state: CatalogEntryState;
  readonly updatedAt: Date;
}
