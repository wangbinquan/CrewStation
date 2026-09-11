/**
 * 目录里的代理名与本代理刻意暴露的那一小片上游接口。
 * 目录操作键是 `<proxy>:<METHOD>:<path>`（packages/contracts/manifest/manifest.ts 的 operationKey），
 * 由平台在发布时从 `openapi.yaml` 的 `paths` 读出来登记，因此这里的清单必须与 openapi.yaml 一致——
 * src/proxy/catalog.test.ts 会逐条比对。
 */

/** 与 crewstation.yaml `spec.proxy` 一致，也是服务域上 `/api/<proxy>/` 的前缀。 */
export const PROXY_NAME = 'test-gitlab';

export interface CatalogOperation {
  readonly method: 'GET' | 'POST';
  /** 本服务看到的路径（网关已剥掉 `/api/<proxy>/`）；`{}` 段按 matchesOperationPath 匹配任意一段。 */
  readonly path: string;
}

/**
 * 刻意只覆盖项目、分支、标签、提交这一小片只读接口，外加一个写操作用来证明请求体确实原样转发。
 * 想扩就在 `openapi.yaml` 里加 `paths`，这里同步补上，然后发布——目录只认发布登记过的操作。
 */
export const OPERATIONS: readonly CatalogOperation[] = [
  { method: 'GET', path: '/v4/projects' },
  { method: 'GET', path: '/v4/projects/{id}' },
  { method: 'GET', path: '/v4/projects/{id}/repository/branches' },
  { method: 'GET', path: '/v4/projects/{id}/repository/branches/{branch}' },
  { method: 'POST', path: '/v4/projects/{id}/repository/branches' },
  { method: 'GET', path: '/v4/projects/{id}/repository/tags' },
  { method: 'GET', path: '/v4/projects/{id}/repository/commits' },
  { method: 'GET', path: '/v4/projects/{id}/repository/commits/{sha}' },
];

/** 目录操作键，与 packages/contracts/manifest/manifest.ts 的 operationKey 算法一致。 */
export function operationKey(method: string, path: string): string {
  return `${PROXY_NAME}:${method.toUpperCase()}:${path}`;
}
