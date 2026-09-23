import type { MiddlewareRender } from '../domain/middlewareRender';
import type { NamespaceRender, NetworkPolicyRender } from '../domain/namespaceRender';
import type { ObservedObject } from '../domain/observation';
import type { RouteRender } from '../domain/routeRender';

/**
 * 观测与调和的种类：任务类容器的子对象（Pod、PVC、Runner Secret、预览 Service 与路由），服务槽的 Deployment，构建与迁移的 Job，限流的 Middleware，
 * 项目的命名空间（集群级）、额度与网络策略。
 */
export type ObservedKind = 'Pod' | 'PersistentVolumeClaim' | 'Secret' | 'Service' | 'IngressRoute' | 'Deployment' | 'Job' | 'Middleware' | 'Namespace' | 'ResourceQuota' | 'NetworkPolicy';

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

/**
 * 观测到的 Pod 交给身份索引（gateway，RFC-025 设计 §7.4）：全平台只剩观测缓存这一条 Pod watch。
 * 系统命名空间里的平台组件也在内（它们不进台账，但要进身份索引）。
 */
export interface PodSubscriber {
  changed(pod: ObservedObject, gone: boolean): Promise<void>;
  /** 观测缓存第一次全量同步完成：这一份是全部受管 Pod，身份索引据此清掉这次没列到的旧行。此后重列时消失的照常以 changed(…, true) 报来。 */
  synced(pods: readonly ObservedObject[]): Promise<void>;
}

/** 一次性列出受管对象（收编空跑报告在 cs-api 里按需算，不开 watch）。 */
export interface ManagedObjectReader {
  list(kind: ObservedKind): Promise<ObservedObject[]>;
}

/**
 * 调和器对集群的写：删除一律带 UID 前置条件，同名的新对象不会被误删。建与改先接路由（不含凭据，第三期后半）；
 * 任务容器与服务槽随凭据的裁定（I25）再移交。
 */
export interface ClusterWriter {
  remove(target: { readonly kind: ObservedKind; readonly namespace?: string; readonly name: string; readonly uid: string }): Promise<void>;
  /** 按路由期望渲染 IngressRoute，与观测缓存里的对象（current）比对：缺了或不一致才 apply。 */
  applyRoute(route: RouteRender, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
  /** 按限流策略渲染 Middleware（带所属记录的资源 ID 标签），同样缺了或不一致才 apply。 */
  applyMiddleware(middleware: MiddlewareRender, resourceId: string, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
  /** 按命名空间记录渲染 Namespace 与它的额度（第四期），各自缺了或不一致才 apply；命名空间从不由调和器删除。 */
  applyNamespace(namespace: NamespaceRender, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
  applyQuota(namespace: NamespaceRender, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
  applyNetworkPolicy(policy: NetworkPolicyRender, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
}
