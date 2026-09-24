import type { DataPlaneSnapshot } from '../domain/dataPlane';

/** 数据面的只读快照：平台数据库集群上带平台前缀的库与角色（实现在 adapters/postgres）。 */
export interface DataPlaneReader {
  snapshot(): Promise<DataPlaneSnapshot>;
  close(): Promise<void>;
}

/** 删一个临时角色的结果：删了；本来就不在；同名的已是另一个角色（OID 对不上，不删）。 */
export type RoleRemoval = 'dropped' | 'absent' | 'replaced';

/** 数据面的写（第四期第三步：先只有删访问绑定的临时角色，删除不需要口令）。 */
export interface DataPlaneWriter {
  /** 先断开它的连接，在所在库里把它拥有的对象转给运行角色、撤销授权，再删角色；给了 OID 就先核对。 */
  dropRole(target: { readonly role: string; readonly oid?: string; readonly database?: string; readonly reassignTo?: string }): Promise<RoleRemoval>;
}
