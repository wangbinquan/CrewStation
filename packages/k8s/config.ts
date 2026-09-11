import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 访问 API Server 所需的一切；进程内运行时用 ServiceAccount，本机开发用 kubeconfig。 */
export interface ClusterConfig {
  server: string;
  token?: string;
  ca?: string;
  clientCert?: string;
  clientKey?: string;
  insecureSkipTlsVerify?: boolean;
  defaultNamespace: string;
}

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';

export function loadClusterConfig(options: { kubeconfigPath?: string; context?: string } = {}): ClusterConfig {
  if (existsSync(join(SA_DIR, 'token'))) return inClusterConfig();
  return fromKubeconfig(options.kubeconfigPath ?? process.env.KUBECONFIG ?? join(homedir(), '.kube', 'config'), options.context);
}

function inClusterConfig(): ClusterConfig {
  const host = process.env.KUBERNETES_SERVICE_HOST ?? 'kubernetes.default.svc';
  const port = process.env.KUBERNETES_SERVICE_PORT ?? '443';
  const namespace = existsSync(join(SA_DIR, 'namespace')) ? readFileSync(join(SA_DIR, 'namespace'), 'utf8').trim() : 'default';
  return { server: `https://${host}:${port}`, token: readFileSync(join(SA_DIR, 'token'), 'utf8').trim(), ca: readFileSync(join(SA_DIR, 'ca.crt'), 'utf8'), defaultNamespace: namespace };
}

interface Kubeconfig {
  'current-context'?: string;
  contexts?: Array<{ name: string; context: { cluster: string; user: string; namespace?: string } }>;
  clusters?: Array<{ name: string; cluster: { server: string; 'certificate-authority-data'?: string; 'certificate-authority'?: string; 'insecure-skip-tls-verify'?: boolean } }>;
  users?: Array<{ name: string; user: { token?: string; 'client-certificate-data'?: string; 'client-key-data'?: string; 'client-certificate'?: string; 'client-key'?: string } }>;
}

export function fromKubeconfig(path: string, contextName?: string): ClusterConfig {
  const cfg = Bun.YAML.parse(readFileSync(path, 'utf8')) as Kubeconfig;
  const name = contextName ?? cfg['current-context'];
  const ctx = cfg.contexts?.find((c) => c.name === name)?.context;
  if (!ctx) throw new Error(`kubeconfig 中没有上下文 ${name}`);
  const cluster = cfg.clusters?.find((c) => c.name === ctx.cluster)?.cluster;
  const user = cfg.users?.find((u) => u.name === ctx.user)?.user;
  if (!cluster || !user) throw new Error(`kubeconfig 上下文 ${name} 缺少 cluster 或 user`);
  const decode = (data?: string, file?: string): string | undefined =>
    data ? Buffer.from(data, 'base64').toString() : file ? readFileSync(file, 'utf8') : undefined;
  const config: ClusterConfig = { server: cluster.server, defaultNamespace: ctx.namespace ?? 'default' };
  const ca = decode(cluster['certificate-authority-data'], cluster['certificate-authority']);
  const cert = decode(user['client-certificate-data'], user['client-certificate']);
  const key = decode(user['client-key-data'], user['client-key']);
  if (ca) config.ca = ca;
  if (cert) config.clientCert = cert;
  if (key) config.clientKey = key;
  if (user.token) config.token = user.token;
  if (cluster['insecure-skip-tls-verify']) config.insecureSkipTlsVerify = true;
  return config;
}
