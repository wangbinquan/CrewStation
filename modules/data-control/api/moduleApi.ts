import type { DatabaseReclamationReader } from './databaseReclamation';
import type { NativePostgresWork } from './databaseRemoval';
import type { NativePostgresSource } from './storageSource';

interface ObjectLocation { readonly backendId: string; readonly placementRevision: number; readonly key: string }
interface ObjectEndpointConfig { readonly endpoint: string; readonly region: string; readonly bucket: string; readonly accessKeyId: string; readonly secretAccessKey: string; readonly monitoring?: { readonly endpoint: string; readonly token: string } }

export interface ObjectDataPlaneApi {
  inspectWrite(location: ObjectLocation, signal: AbortSignal): Promise<'committed' | 'unknown'>;
  prepareRotation(input: { backendId: string; placementRevision: number; credentialRevision: number; accessKeyId: string; secretAccessKey: string; monitoringToken?: string }, signal: AbortSignal): Promise<{ commit(transaction: object): Promise<void> }>;
  put(location: ObjectLocation, input: { body: ReadableStream<Uint8Array>; size: number; sha256: string; signal: AbortSignal; onBytes?: (bytes: number) => void }): Promise<{ size: number; sha256: string }>;
  get(location: ObjectLocation, input: { signal: AbortSignal; range?: string; expected?: { size: number; sha256: string } }): Promise<{ body: ReadableStream<Uint8Array>; size: number; contentRange?: string; completed: Promise<{ size: number; sha256: string }> }>;
  verify(location: ObjectLocation, signal: AbortSignal, expected?: { size: number; sha256: string }): Promise<{ size: number; sha256: string }>;
  remove(location: ObjectLocation, signal: AbortSignal): Promise<void>;
  configure(backendId: string, placementRevision: number, credentialRevision: number, config: ObjectEndpointConfig): Promise<void>;
  probe(backendId: string, placementRevision: number, signal: AbortSignal): Promise<{ backendId: string; placementRevision: number; credentialRevision: number; health: 'ready' | 'degraded' | 'unavailable'; message: string | null; observedAt: string; freeBytes?: number | null; totalBytes?: number | null; physicalObservedAt?: string | null }>;
  metrics(): string;
}
/** data-control 模块对外能力；每个用例在此增加一个方法签名，实现放在 application/。 */
export interface DataControlModuleApi {
  readonly name: 'data-control';
  readonly objects?: ObjectDataPlaneApi;
  /** Internal original-OID physical evidence; does not authorize or perform deletion. */
  readonly databaseReclamation?: DatabaseReclamationReader;
  /** Trusted composition only; every original writer shares native name locks and durable work facts. */
  readonly nativePostgres?: NativePostgresWork;
  /** Internal read-only independent storage observer; unavailable sources block complete purge. */
  readonly nativePostgresSource?: NativePostgresSource;
  /**
   * RFC-025 I28：data-control 建库时生成的运行角色口令（解密后的明文）；data 渲染容器的连接串时经端口要，值不进台账。
   * 这条记录的库不是 data-control 建的（旧库）或还没存下口令时返回 undefined。
   */
  credentialOf(resourceId: string): Promise<{ role: string; password: string } | undefined>;
  withCredentialAdmission<T>(resourceId: string, work: () => Promise<T>): Promise<T>;
  /** 仅供组合根在项目空闲锁下调用；传入同一数据库事务，与台账轮换标记一起提交。 */
  stageRotation(resourceId: string, transaction: object): Promise<void>;
  finishRotation(resourceId: string, transaction: object): Promise<void>;
}
