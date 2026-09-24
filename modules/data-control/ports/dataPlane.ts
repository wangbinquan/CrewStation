import type { DataPlaneSnapshot } from '../domain/dataPlane';

/** 数据面的只读快照：平台数据库集群上带平台前缀的库与角色（实现在 adapters/postgres）。 */
export interface DataPlaneReader {
  snapshot(): Promise<DataPlaneSnapshot>;
  close(): Promise<void>;
}

/** 删一个临时角色的结果：删了；本来就不在；同名的已是另一个角色（OID 对不上，不删）。 */
export type RoleRemoval = 'dropped' | 'absent' | 'replaced';

/** 数据面的写：删访问绑定的临时角色（第四期第三步）；建库与运行角色（I28，口令由调用方先存下再给）。 */
export interface DataPlaneWriter {
  /** 先断开它的连接，在所在库里把它拥有的对象转给运行角色、撤销授权，再删角色；给了 OID 就先核对。 */
  dropRole(target: { readonly role: string; readonly oid?: string; readonly database?: string; readonly reassignTo?: string }): Promise<RoleRemoval>;
  /**
   * 建出一个库与它同名的运行角色：角色在就改成这个口令、不在就建（LOGIN）；库不在就建（属主是这个角色）；撤销 PUBLIC 的 CONNECT，
   * 只给这个角色——跨项目不可连（AT-12）。重复执行结果不变。
   */
  ensureDatabase(target: { readonly database: string; readonly role: string; readonly password: string }): Promise<void>;
  /**
   * 建出访问绑定的临时角色（I28 第二步）：在就改成这个口令与到期时间，不在就建（LOGIN、VALID UNTIL，数据库自己执行到期）；
   * 只给所在的生产库 CONNECT；只读的授 pg_read_all_data，可写的继承运行角色。重复执行结果不变。
   */
  ensureTemporaryRole(target: { readonly role: string; readonly database: string; readonly ownerRole: string; readonly readOnly: boolean; readonly validUntil: string; readonly password: string }): Promise<void>;
}
