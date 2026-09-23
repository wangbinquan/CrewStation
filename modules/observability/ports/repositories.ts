import type { AlertDto, AlertType, ProjectId } from '@crewstation/contracts';
import { slotOfAlert } from '../domain/alertRules';

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

export function alertToDto(a: AlertRecord): AlertDto {
  const slot = slotOfAlert(a.type, a.key);
  return { id: a.id, projectId: a.projectId, type: a.type, state: a.state, detail: a.detail, firedAt: a.firedAt.toISOString(), ...(a.resolvedAt ? { resolvedAt: a.resolvedAt.toISOString() } : {}), ...(slot ? { slot } : {}) };
}
