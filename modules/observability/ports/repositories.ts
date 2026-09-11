import type { AlertDto, AlertType, ProjectId, UserId } from '@crewstation/contracts';

export interface AlertRecord {
  id: string;
  projectId: ProjectId;
  type: AlertType;
  key: string;
  state: 'firing' | 'resolved';
  detail: string;
  firedAt: Date;
  resolvedAt?: Date;
}

export interface AlertRepository {
  firing(projectId: ProjectId): Promise<AlertRecord[]>;
  list(projectId: ProjectId, limit: number): Promise<AlertRecord[]>;
  fire(alert: AlertRecord): Promise<void>;
  resolve(projectId: ProjectId, key: string, at: Date): Promise<AlertRecord[]>;
}

export interface SubscriptionRecord { projectId: ProjectId; userId: UserId; channel: 'workbench' | 'webhook'; target?: string }

export interface AlertSubscriptionRepository {
  list(projectId: ProjectId): Promise<SubscriptionRecord[]>;
  upsert(record: SubscriptionRecord): Promise<void>;
  remove(projectId: ProjectId, userId: UserId): Promise<void>;
}

export function alertToDto(a: AlertRecord): AlertDto {
  return { id: a.id, projectId: a.projectId, type: a.type, state: a.state, detail: a.detail, firedAt: a.firedAt.toISOString(), ...(a.resolvedAt ? { resolvedAt: a.resolvedAt.toISOString() } : {}) };
}
