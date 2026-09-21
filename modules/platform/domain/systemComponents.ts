/** Installed component names are explicit; a namespace alone never claims unrelated workloads. */
export function installedSystemComponents() {
  const core = ['cs-api', 'cs-auth', 'cs-controller', 'cs-session', 'cs-events', 'console', 'mcp-capabilities', 'mcp-operations'];
  const infra = ['traefik', 'registry', 'buildkitd', 'crewstation-dev-auth'];
  const resources = (names: string[], purpose: 'platform-service' | 'platform-infrastructure') => names.flatMap((name) => [
    { kind: 'Deployment', name, component: name, purpose, restart: true, impact: [`${name} 将短暂不可用，等待新 Pod 就绪；现有连接可能中断`] },
    { kind: 'Service', name, component: name, purpose, restart: false, impact: [] },
  ]);
  const fixed = [
    ['StatefulSet', 'prometheus', 'prometheus'], ['Service', 'prometheus', 'prometheus'], ['DaemonSet', 'cs-storage-probe', 'cs-storage-probe'], ['ConfigMap', 'prometheus-config', 'prometheus'], ['ConfigMap', 'crewstation-metrics-env', 'cluster-metrics'], ['Secret', 'crewstation-metrics', 'cluster-metrics'], ['NetworkPolicy', 'crewstation-prometheus', 'prometheus'], ['NetworkPolicy', 'crewstation-storage-probe', 'cs-storage-probe'],
    ['Namespace', 'crewstation-system', 'platform'], ['IngressRoute', 'crewstation-dev-auth', 'crewstation-dev-auth'], ['StatefulSet', 'postgres', 'postgres'], ['Service', 'postgres', 'postgres'], ['Service', 'postgres-headless', 'postgres'],
    ['Job', 'crewstation-migrate', 'migration'], ['ConfigMap', 'crewstation-env', 'platform'], ['ConfigMap', 'buildkitd-config', 'buildkitd'], ['PersistentVolumeClaim', 'buildkitd-cache', 'buildkitd'], ['PersistentVolumeClaim', 'registry-data', 'registry'], ['ServiceAccount', 'crewstation-control', 'platform'], ['ServiceAccount', 'traefik', 'traefik'],
    ...['forward-auth-user', 'forward-auth-service', 'drop-identity-headers', 'forward-auth-registry'].map((name) => ['Middleware', name, 'gateway']),
    ...['console-auth', 'console-api', 'console-stream', 'console-app', 'platform-api-jwks', 'platform-api', 'platform-events', 'platform-mcp-capabilities', 'platform-mcp-operations', 'registry-push', 'registry-push-tls'].map((name) => ['IngressRoute', name, 'gateway']),
  ];
  return [...resources(core, 'platform-service'), ...resources(infra, 'platform-infrastructure'), ...fixed.map(([kind, name, component]) => ({ kind: kind!, name: name!, component: component!, purpose: 'platform-infrastructure' as const, restart: kind === 'StatefulSet' || kind === 'DaemonSet', impact: kind === 'StatefulSet' || kind === 'DaemonSet' ? [component === 'postgres' ? '数据库连接将中断，操作结果在数据库恢复后继续核对' : '指标采集或历史查询将短暂不可用，资源管理操作仍可使用'] : [] }))];
}
