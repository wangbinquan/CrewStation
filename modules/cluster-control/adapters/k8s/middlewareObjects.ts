import type { K8sObject } from '@crewstation/k8s';
import { LABELS, platformLabels } from '@crewstation/k8s';
import type { MiddlewareKey, MiddlewareRender } from '../../domain/middlewareRender';
import { RESOURCE_ID_LABEL } from '../../domain/observation';

const criterion = (key: MiddlewareKey) => ('header' in key ? { requestHeaderName: key.header } : { requestHost: true });

/**
 * 按限流策略渲染 Traefik Middleware（RFC-025 设计 §7.3）：令牌桶是 rateLimit（每秒平均、突发，周期 1 秒），并发上限是 inFlightReq；
 * 分桶按网关注入的身份头或主机。带所属记录的资源 ID 标签：系统命名空间里的也归台账观测与回收。
 */
export function middlewareObject(middleware: MiddlewareRender, resourceId: string): K8sObject {
  const spec = middleware.rateLimit
    ? { rateLimit: { average: middleware.rateLimit.average, burst: middleware.rateLimit.burst, period: '1s', sourceCriterion: criterion(middleware.rateLimit.key) } }
    : { inFlightReq: { amount: middleware.inFlight!.amount, sourceCriterion: criterion(middleware.inFlight!.key) } };
  return {
    apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware',
    metadata: { name: middleware.name, namespace: middleware.namespace, labels: platformLabels({ [LABELS.component]: 'rate-limit', [RESOURCE_ID_LABEL]: resourceId }) },
    spec,
  } as K8sObject;
}
