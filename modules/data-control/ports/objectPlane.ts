export interface ObjectEndpointConfig {
  readonly endpoint: string; readonly region: string; readonly bucket: string;
  readonly accessKeyId: string; readonly secretAccessKey: string;
  readonly monitoring?: { readonly endpoint: string; readonly token: string };
}
export interface ObjectPhysicalObservation { readonly freeBytes: number | null; readonly totalBytes: number | null; readonly physicalObservedAt: string | null; readonly health: 'ready' | 'degraded' | 'unavailable' }
export interface StoredObjectEndpoint {
  readonly backendId: string; readonly placementRevision: number; readonly credentialRevision: number;
  readonly endpoint: string; readonly region: string; readonly bucket: string; readonly credentialsBox: string;
}
export interface ObjectEndpointStore {
  get(backendId: string, placementRevision: number): Promise<StoredObjectEndpoint | undefined>;
  put(record: StoredObjectEndpoint): Promise<StoredObjectEndpoint>;
}
export interface ObjectLocation { readonly backendId: string; readonly placementRevision: number; readonly key: string }
export interface ObjectBytePlane {
  inspectWrite(location: ObjectLocation, signal: AbortSignal): Promise<'committed' | 'unknown'>;
  put(location: ObjectLocation, input: { body: ReadableStream<Uint8Array>; size: number; sha256: string; signal: AbortSignal; onBytes?: (bytes: number) => void }): Promise<{ size: number; sha256: string }>;
  get(location: ObjectLocation, input: { signal: AbortSignal; range?: string; expected?: { size: number; sha256: string } }): Promise<{ body: ReadableStream<Uint8Array>; size: number; contentRange?: string; completed: Promise<{ size: number; sha256: string }> }>;
  verify(location: ObjectLocation, signal: AbortSignal, expected?: { size: number; sha256: string }): Promise<{ size: number; sha256: string }>;
  remove(location: ObjectLocation, signal: AbortSignal): Promise<void>;
}
export interface ObjectTransferMeasurement {
  readonly backendId: string; readonly spaceId: string; readonly operation: 'put' | 'get' | 'verify' | 'delete' | 'head';
  readonly result: 'ok' | 'error' | 'aborted'; readonly bytes: number; readonly durationSeconds: number;
}
export interface ObjectTransferMeter { record(value: ObjectTransferMeasurement): void }
