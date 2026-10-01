import type { DataPlaneSnapshot } from '../domain/dataPlane';
import type { ProjectId } from '@crewstation/contracts';
import type { ProjectDeletionContext, ProjectDeletionInventory } from '@crewstation/contracts';

interface NativePostgresCatalogIdentity { readonly kind: 'database' | 'role'; readonly name: string; readonly oid: string }
interface NativePostgresStorageSource {
  readonly identity: string; readonly serviceUid: string; readonly observedAt: string;
  readonly server: { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly address: string };
  readonly volumes: readonly { readonly pvcUid: string; readonly pvUid: string; readonly nodeUid: string; readonly mountPath: string; readonly providerPath: string; readonly rootEpoch: string; readonly volumeEpoch: string;
    readonly entries: readonly { readonly key: string; readonly relativePath: string; readonly kind: 'file' | 'directory'; readonly identity: string }[] }[];
}
interface NativePostgresJournalRecord {
  readonly workId: string; readonly resourceId: string; readonly projectId: ProjectId; readonly names: readonly string[]; readonly state: 'running' | 'finished'; readonly journalVersion: 1 | null;
  readonly nativeSession: { readonly pid: number; readonly started: string; readonly sourceIdentity: string } | null;
  readonly process: { readonly podUid: string; readonly containerId: string; readonly nodeUid: string; readonly nodeName: string } | null; readonly proofDigest: string | null;
  readonly before: { readonly catalog: readonly NativePostgresCatalogIdentity[]; readonly storage: NativePostgresStorageSource | null } | null;
  readonly after: { readonly catalog: readonly NativePostgresCatalogIdentity[]; readonly storage: NativePostgresStorageSource | null } | null;
}
interface OriginalPostgresRole { readonly name: string; readonly oid: string; readonly source: string; readonly identity: string }
interface OriginalPostgresDatabase extends OriginalPostgresRole { readonly directories: readonly { readonly tablespaceOid: string | null; readonly root: string }[] }

interface NativePostgresOrigin { readonly projectId: ProjectId; readonly resourceId: string }

/** 数据面的只读快照：平台数据库集群上带平台前缀的库与角色（实现在 adapters/postgres）。 */
export interface DataPlaneReader {
  snapshot(): Promise<DataPlaneSnapshot>;
  close(): Promise<void>;
}

/** 删一个临时角色的结果：删了；本来就不在；同名的已是另一个角色（OID 对不上，不删）。 */
export type RoleRemoval = 'dropped' | 'absent' | 'replaced';

/** 数据面的写：删访问绑定的临时角色（第四期第三步）；建库与运行角色（I28，口令由调用方先存下再给）。 */
export interface DataPlaneWriter {
  /** 只改现有角色口令；仍有连接时拒绝，不断开使用者、不重启容器。 */
  rotatePassword(target: { readonly role: string; readonly password: string; readonly origin?: NativePostgresOrigin }): Promise<void>;
  /** 先断开它的连接，在所在库里把它拥有的对象转给运行角色、撤销授权，再删角色；给了 OID 就先核对。 */
  dropRole(target: { readonly role: string; readonly oid?: string; readonly database?: string; readonly reassignTo?: string; readonly origin?: NativePostgresOrigin }): Promise<RoleRemoval>;
  /**
   * 建出一个库与它同名的运行角色：角色在就改成这个口令、不在就建（LOGIN）；库不在就建（属主是这个角色）；撤销 PUBLIC 的 CONNECT，
   * 只给这个角色——跨项目不可连（AT-12）。重复执行结果不变。
   */
  ensureDatabase(target: { readonly database: string; readonly role: string; readonly password: string; readonly origin?: NativePostgresOrigin }): Promise<void>;
  /**
   * 建出访问绑定的临时角色（I28 第二步）：在就改成这个口令与到期时间，不在就建（LOGIN、VALID UNTIL，数据库自己执行到期）；
   * 只给所在的生产库 CONNECT；只读的授 pg_read_all_data，可写的继承运行角色。重复执行结果不变。
   */
  ensureTemporaryRole(target: { readonly role: string; readonly database: string; readonly ownerRole: string; readonly readOnly: boolean; readonly validUntil: string; readonly password: string; readonly origin?: NativePostgresOrigin }): Promise<void>;
}

/** Inverted retained history. The root combines data and resources without granting physical deletion. */
export interface NativeDeletionHistory {
  read(projectId: ProjectId): Promise<{
    readonly complete: boolean; readonly revision: string;
    readonly records: readonly { resourceId: string; aliases: readonly string[]; names: readonly { kind: 'database' | 'role'; name: string; oid?: string }[] }[];
    readonly blockers: ProjectDeletionInventory['blockers']; readonly references: ProjectDeletionInventory['references'];
  }>;
}
export interface NativeDeletionSnapshot {
  readonly entities: readonly string[];
  readonly credentials: readonly { resourceId: string; role: string; digest: string }[];
  readonly journal: readonly NativePostgresJournalRecord[];
  readonly foreignKeys: readonly string[];
  readonly unownedCredentials: readonly string[];
  readonly metadata: ProjectDeletionInventory['resources'];
}
export interface NativeDeletionPlan {
  readonly keys: readonly string[];
  readonly names: readonly { kind: 'database' | 'role'; name: string }[];
  readonly catalog: readonly NativePostgresCatalogIdentity[];
  readonly sources: readonly NativePostgresStorageSource[];
  readonly sessions: readonly NonNullable<NativePostgresJournalRecord['nativeSession']>[];
}
/** Only original physical identities; contents, ciphertexts and passwords are never persisted here. */
export interface NativeDeletionScope {
  readonly version: 1; readonly plan: NativeDeletionPlan;
  readonly storage: NativePostgresStorageSource | null;
  readonly databases: readonly OriginalPostgresDatabase[];
  readonly roles: readonly OriginalPostgresRole[];
  readonly absent: readonly { kind: 'database' | 'role'; name: string }[];
}
export type NativeDeletionProof = { readonly kind: 'done'; readonly digest: string; readonly count: number } | { readonly kind: 'waiting'; readonly reason: string };
export interface NativeDeletionPhysics {
  capture(plan: NativeDeletionPlan): Promise<NativeDeletionScope>;
  stop(scope: NativeDeletionScope): Promise<NativeDeletionProof>;
  purge(context: ProjectDeletionContext, scope: NativeDeletionScope): Promise<NativeDeletionProof>;
  prove(scope: NativeDeletionScope): Promise<NativeDeletionProof>;
}
export interface NativeDeletionRepository {
  snapshot(projectId: ProjectId, keys: readonly string[]): Promise<NativeDeletionSnapshot>;
  close(context: ProjectDeletionContext): Promise<void>;
  bind(context: ProjectDeletionContext, scope: NativeDeletionScope): Promise<void>;
  assert(context: ProjectDeletionContext): Promise<void>;
  load(context: ProjectDeletionContext): Promise<{ scope: NativeDeletionScope | null; proofs: Partial<Record<'stop' | 'purge' | 'prove', string>>; metadataPurged: boolean; completed: { digest: string; count: number } | null }>;
  record(context: ProjectDeletionContext, digest: string): Promise<void>;
  purgeMetadata(context: ProjectDeletionContext): Promise<void>;
  complete(context: ProjectDeletionContext, digest: string, count: number): Promise<void>;
}
