import type { ObservedObject } from '../domain/observation';

/** 观测与调和的种类：任务类容器的子对象（Pod、PVC、Runner Secret、预览 Service 与路由），服务槽的 Deployment；后续各期加入 Job、Middleware…… */
export type ObservedKind = 'Pod' | 'PersistentVolumeClaim' | 'Secret' | 'Service' | 'IngressRoute' | 'Deployment';

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
  /** 观测缓存里的对象；同步完成之前的「没有」不能当成对象不存在。 */
  cached(kind: ObservedKind, namespace: string | undefined, name: string): ObservedObject | undefined;
  /** 观测缓存里这一种的全部对象（孤儿回收逐个核对）。 */
  list(kind: ObservedKind): readonly ObservedObject[];
}

/** 一次性列出受管对象（收编空跑报告在 cs-api 里按需算，不开 watch）。 */
export interface ManagedObjectReader {
  list(kind: ObservedKind): Promise<ObservedObject[]>;
}

/** 调和器对集群的写（第二期只有删除）：一律带 UID 前置条件，同名的新对象不会被误删；建与改随凭据的裁定（I25）再移交。 */
export interface ClusterWriter {
  remove(target: { readonly kind: ObservedKind; readonly namespace?: string; readonly name: string; readonly uid: string }): Promise<void>;
}
