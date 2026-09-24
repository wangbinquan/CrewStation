import type { MiddlewareRender } from '../domain/middlewareRender';
import type { NamespaceRender, NetworkPolicyRender } from '../domain/namespaceRender';
import type { ObservedObject } from '../domain/observation';
import type { RouteRender } from '../domain/routeRender';
import type { SlotRender } from '../domain/slotRender';
import type { VolumeRender, WorkloadPodRender, WorkloadPreviewRender } from '../domain/workloadRender';

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
  /**
   * 工作区的容器（RFC-025 I25）：Pod、PVC 按名字建，已在就不动（建了不改），返回实例 UID 与是不是这次建的。
   * Runner Secret 先向 API Server 确认不在，才调 values 向所属模块要内容再建（不可变）——已在的不读内容、不重签令牌。
   */
  ensurePod(pod: WorkloadPodRender): Promise<Ensured>;
  ensureRunnerSecret(pod: WorkloadPodRender, values: () => Promise<Readonly<Record<string, string>>>): Promise<Ensured>;
  /** 这一次启动检出用的 Git 凭据 Secret：同样先确认不在，才向所属模块要令牌再建（不可变）。 */
  ensureCheckoutSecret(pod: WorkloadPodRender, values: () => Promise<{ readonly token: string }>): Promise<Ensured>;
  ensureVolume(volume: VolumeRender): Promise<Ensured>;
  /** 开发预览的 Service 与路由：各自缺了或不一致才服务端 apply。 */
  applyPreview(preview: WorkloadPreviewRender, current: { readonly service?: ObservedObject; readonly route?: ObservedObject }): Promise<'applied' | 'unchanged'>;
  /**
   * 服务槽（T8）：这一次部署的环境 Secret 先确认不在，才调 values 向 release 要内容再建（不可变）；Service 与 Deployment 按期望渲染，
   * 缺了或不一致才 apply——Deployment 带上渲染它的期望版本（generation）。
   */
  ensureSlotSecret(slot: SlotRender, values: () => Promise<Readonly<Record<string, string>>>): Promise<Ensured>;
  applySlotService(slot: SlotRender, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
  applySlotDeployment(slot: SlotRender, generation: number, current: ObservedObject | undefined): Promise<'applied' | 'unchanged'>;
  /** 统一预检的集群一步（设计 §5）：同样的三个对象以服务端 dry-run 提交一次，不改集群；API Server 拒绝时抛出它给的原因。 */
  dryRunSlot(slot: SlotRender, generation: number, values: Readonly<Record<string, string>>): Promise<void>;
}

/** 按名字建出的对象：实例 UID，与是不是这次建的（已在就不动）。 */
export interface Ensured {
  readonly uid: string;
  readonly created: boolean;
}
