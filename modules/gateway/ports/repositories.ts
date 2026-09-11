import type { AllowlistDocument, RouteEntry } from '@crewstation/contracts';
import type { PodIdentityRecord } from '../domain/podIdentity';

export interface AllowlistRepository {
  latest(): Promise<AllowlistDocument | undefined>;
  save(doc: AllowlistDocument): Promise<void>;
}

export interface PodIdentityRepository {
  upsert(record: Omit<PodIdentityRecord, 'version'>): Promise<PodIdentityRecord>;
  markDeleted(podName: string, namespace: string, at: Date): Promise<void>;
  byIp(ip: string): Promise<PodIdentityRecord | undefined>;
  listActive(): Promise<PodIdentityRecord[]>;
}

export interface RouteRepository {
  saveForService(serviceName: string, routes: RouteEntry[]): Promise<void>;
  listAll(): Promise<Array<{ serviceName: string; routes: RouteEntry[] }>>;
}
