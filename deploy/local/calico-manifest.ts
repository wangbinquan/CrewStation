/**
 * 本机集群的网络插件 Calico：官方清单的版本与校验和钉死在这里，再做三处本机定制，定制后的清单写到标准输出。
 * deploy/local/calico-cni.sh 调用：`bun deploy/local/calico-manifest.ts`（下载官方清单）或 `--file <路径>`（用本地文件）。
 * 为什么不用 Docker Desktop 自带的 kindnet，见 docs/engineering/dev-gotchas.md「本机集群的网络插件是 Calico」。
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const CALICO_VERSION = 'v3.32.2';
export const CALICO_MANIFEST_URL = `https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/calico.yaml`;
export const CALICO_MANIFEST_SHA256 = 'a8c828a06a87c629a282ebbc424895b77f3a030251993e41ea400a743675bb02';
/**
 * 在 kube-proxy 的 clusterCIDR（10.244.0.0/16）之内：集群内不做源地址转换，网关才能按源 Pod IP 认身份（Q21）。
 * 避开节点 podCIDR 10.244.0.0/24：原地从 kindnet 迁移时，旧 Pod 还占着 host-local 分配的地址，新旧不撞。
 */
export const CALICO_POOL_CIDR = '10.244.128.0/17';

interface Edit { readonly what: string; readonly find: string; readonly replace: string }

const EDITS: readonly Edit[] = [
  {
    what: '节点地址按 Kubernetes 登记的 InternalIP 取，不让自动探测挑到 Docker Desktop 的其他网卡',
    find: '            - name: IP\n              value: "autodetect"\n',
    replace: '            - name: IP\n              value: "autodetect"\n            - name: IP_AUTODETECTION_METHOD\n              value: "kubernetes-internal-ip"\n',
  },
  {
    what: '单节点不需要 IPIP 封装',
    find: '            - name: CALICO_IPV4POOL_IPIP\n              value: "Always"\n',
    replace: '            - name: CALICO_IPV4POOL_IPIP\n              value: "Never"\n',
  },
  {
    what: `地址池 ${CALICO_POOL_CIDR}`,
    find: '            # - name: CALICO_IPV4POOL_CIDR\n            #   value: "192.168.0.0/16"\n',
    replace: `            - name: CALICO_IPV4POOL_CIDR\n              value: "${CALICO_POOL_CIDR}"\n`,
  },
];

export function manifestSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 每处定制在官方清单里都必须恰好出现一次；对不上说明上游结构变了，宁可停下也不装一份猜出来的清单。 */
export function customizeCalicoManifest(text: string): string {
  let out = text;
  for (const edit of EDITS) {
    const count = out.split(edit.find).length - 1;
    if (count !== 1) throw new Error(`Calico 清单的结构和 ${CALICO_VERSION} 不一致（${edit.what}：锚点出现 ${count} 次），先核对上游清单再改这里`);
    out = out.replace(edit.find, edit.replace);
  }
  return out;
}

async function readManifest(args: readonly string[]): Promise<string> {
  const at = args.indexOf('--file');
  if (at >= 0) {
    const path = args[at + 1];
    if (!path) throw new Error('--file 后面要跟清单路径');
    return readFileSync(path, 'utf8');
  }
  const response = await fetch(CALICO_MANIFEST_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`下载 Calico 清单失败：HTTP ${response.status} ${CALICO_MANIFEST_URL}`);
  return response.text();
}

if (import.meta.main) {
  const text = await readManifest(process.argv.slice(2));
  const sum = manifestSha256(text);
  if (sum !== CALICO_MANIFEST_SHA256) {
    console.error(`Calico 清单校验和不符：期望 ${CALICO_MANIFEST_SHA256}，实际 ${sum}（${CALICO_VERSION}）`);
    process.exit(1);
  }
  process.stdout.write(customizeCalicoManifest(text));
}
