import type { ResourceChild } from '@crewstation/contracts';

/** 台账记录里数据面观测用得到的部分（结构上是 resources 模块 LedgerRecord 的子集）。 */
export interface DataRecordView {
  readonly id: string;
  readonly kind: string;
  readonly desired?: 'present' | 'absent';
  /** 子对象清单是公共部分；访问绑定另有临时角色所在的库与运行角色（`database`、`ownerRole`）。 */
  readonly spec: { readonly children: readonly { readonly kind: string; readonly namespace?: string; readonly name: string }[]; readonly [field: string]: unknown };
  readonly children: readonly ResourceChild[];
}

/** 资源中心（resources 模块）给数据面观测的入口，由组合根接上。 */
export interface DataLedgerObservations {
  get(id: string): Promise<DataRecordView | undefined>;
  /** 在册（没结束）的数据库与数据访问绑定记录：定期全量核对时逐条核对。 */
  listLive(): Promise<readonly DataRecordView[]>;
  changesSince(cursor: number, limit: number): Promise<readonly { readonly seq: number; readonly resourceId: string }[]>;
  latestChange(): Promise<number>;
  /** 按记录 ID 写一条子对象观测（数据面的对象没有标签，只能按记录认领）。 */
  observe(input: { readonly resourceId: string; readonly child: ResourceChild; readonly gone?: boolean }): Promise<{ readonly status: 'recorded' | 'unchanged' | 'unowned' }>;
}
