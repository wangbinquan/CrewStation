import type { ManifestKind, ProjectId, ServiceId } from '@crewstation/contracts';

/** 首版一个项目一个服务；服务身份 `<project>/<service>` 是网关与放行表使用的名字。 */
export interface Service {
  readonly id: ServiceId;
  readonly projectId: ProjectId;
  readonly name: string;
  readonly kind: ManifestKind;
  readonly identity: string;
  readonly createdAt: Date;
}

export function serviceIdentity(projectSlug: string, serviceName: string): string {
  return `${projectSlug}/${serviceName}`;
}
