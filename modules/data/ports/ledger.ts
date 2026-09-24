import type { BindingDeclaration, DatabaseDeclaration, ReleaseReason } from '../domain/dataRecords';

/** 资源中心（RFC-025）的写入口：data 写生产库、开发库与访问绑定的期望，实况由资源中心写。由组合根接到 resources 模块。 */
export interface DataLedger {
  declare(input: DatabaseDeclaration | BindingDeclaration): Promise<unknown>;
  /** 阶段：由 data-control 建库时（I28），data 据此等库与运行角色都建好（就绪）。 */
  get(id: string): Promise<{ readonly id: string; readonly desired: 'present' | 'absent'; readonly phase?: string } | undefined>;
  requestRelease(id: string, reason: ReleaseReason): Promise<unknown>;
  /** data 名下期望仍在的访问绑定记录：补投影据此找出绑定已结束（或已不在）却还没释放的。 */
  presentBindings(): Promise<readonly { readonly id: string }[]>;
}
