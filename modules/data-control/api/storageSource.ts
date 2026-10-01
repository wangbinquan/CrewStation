import type { NativeDdlConnection } from './databaseRemoval';

export interface NativePostgresVolumeSource {
  readonly pvcUid: string; readonly pvUid: string; readonly nodeUid: string;
  readonly mountPath: string; readonly providerPath: string;
  readonly rootEpoch: string; readonly volumeEpoch: string;
  readonly entries: readonly { key: string; relativePath: string; kind: 'file' | 'directory'; identity: string }[];
}
export interface NativePostgresStorageSource {
  readonly identity: string;
  readonly serviceUid: string;
  readonly volumes: readonly NativePostgresVolumeSource[];
  /** Current observer only; a normal server restart can prove the same original volume again. */
  readonly server: { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly address: string };
  readonly observedAt: string;
}
/** Trusted original connection only. SQL fingerprints never substitute for independent volume epochs. */
export interface NativePostgresSource {
  capture(connection: NativeDdlConnection): Promise<NativePostgresStorageSource>;
  verify(connection: NativeDdlConnection, original: NativePostgresStorageSource): Promise<void>;
}
