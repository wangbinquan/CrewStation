import type { K8sObject } from '../resources';
import { platformLabels } from './labels';

export interface RouteTarget { name: string; port: number; namespace?: string }
export interface MiddlewareRef { name: string; namespace?: string }

/** 一条 Host（可带路径前缀）路由到一个 Service；用户域与服务域只差挂的中间件。 */
export function ingressRouteObject(spec: { name: string; namespace: string; host: string; pathPrefix?: string; target: RouteTarget; middlewares?: MiddlewareRef[]; labels?: Record<string, string>; priority?: number }): K8sObject {
  const match = spec.pathPrefix ? `Host(\`${spec.host}\`) && PathPrefix(\`${spec.pathPrefix}\`)` : `Host(\`${spec.host}\`)`;
  return {
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'IngressRoute',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels ?? {}) },
    spec: {
      entryPoints: ['web'],
      routes: [{
        match,
        kind: 'Rule',
        ...(spec.priority ? { priority: spec.priority } : {}),
        services: [{ name: spec.target.name, port: spec.target.port, ...(spec.target.namespace ? { namespace: spec.target.namespace } : {}) }],
        middlewares: (spec.middlewares ?? []).map((m) => ({ name: m.name, ...(m.namespace ? { namespace: m.namespace } : {}) })),
      }],
    },
  };
}

/** ForwardAuth 中间件：网关先问 cs-auth，再把响应头注入并剥离外部同名头。 */
export function forwardAuthMiddleware(spec: { name: string; namespace: string; address: string; authResponseHeaders: string[] }): K8sObject {
  return {
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'Middleware',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels() },
    spec: { forwardAuth: { address: spec.address, trustForwardHeader: false, authResponseHeaders: spec.authResponseHeaders } },
  };
}

export function stripPrefixMiddleware(spec: { name: string; namespace: string; prefixes: string[] }): K8sObject {
  return { apiVersion: 'traefik.io/v1alpha1', kind: 'Middleware', metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels() }, spec: { stripPrefix: { prefixes: spec.prefixes } } };
}

/** 进入后端前删除外部可能伪造的身份头（AT-05）。 */
export function dropIdentityHeadersMiddleware(spec: { name: string; namespace: string; headers: string[] }): K8sObject {
  return {
    apiVersion: 'traefik.io/v1alpha1',
    kind: 'Middleware',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels() },
    spec: { headers: { customRequestHeaders: Object.fromEntries(spec.headers.map((h) => [h, ''])) } },
  };
}
