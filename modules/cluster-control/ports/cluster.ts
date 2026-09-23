import type { ObservedObject } from '../domain/observation';

/** 第一期观测的种类；后续各期逐个加入 Secret、Service、Deployment、Job、IngressRoute…… */
export type ObservedKind = 'Pod' | 'PersistentVolumeClaim';

export interface ObjectChange {
  readonly kind: ObservedKind;
  readonly object: ObservedObject;
  readonly gone: boolean;
}

/** 受管对象的变化流：list＋watch 的观测缓存，按对象去重后逐个交给处理者。 */
export interface ManagedObjectFeed {
  start(handle: (change: ObjectChange) => Promise<void>): void;
  stop(): Promise<void>;
  /** 各种类都完成第一次全量，且全量带进来的变化都已交给处理者处理完。 */
  synced(): Promise<void>;
}

/** 一次性列出受管对象（收编空跑报告在 cs-api 里按需算，不开 watch）。 */
export interface ManagedObjectReader {
  list(kind: ObservedKind): Promise<ObservedObject[]>;
}
