import type { UserDto } from '@crewstation/contracts';

/** 后台工作器与事件订阅共用的生命周期形状；进程按角色启动一组。 */
export interface Lifecycle {
  start(): void;
  stop(): Promise<void>;
}

/** Router and migration implementations are selected by wiring, keeping this API independent of adapters. */
export interface PlatformApi<Router, Migration> {
  readonly storageContract: { version: number; check(): Promise<{ requiredVersion: number; enabled: boolean }>; enable(): Promise<void> };
  readonly name: 'platform';
  readonly initializePlatformRoles: () => Promise<{ initialized: number }>;
  readonly bootstrapAdmin: (raw: unknown) => Promise<UserDto>;
  readonly routers: { controller: Router[]; api: Router[]; transfers: Router[]; auth: Router[]; session: Router[]; events: Router[] };
  readonly background: { controller: Lifecycle[]; api: Lifecycle[]; session: Lifecycle[]; events: Lifecycle[] };
  readonly websocket: unknown;
  readonly migrations: Migration[];
}
