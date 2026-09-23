import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// calico-cni.sh 的旧网段判定：kubectl 与节点命令打桩，jq 用真的（脚本本来就依赖它）。
// 打桩的 kubectl 模拟 `delete --wait=false` 的真实效果：被删的 Pod 仍在列表里，只是带上 deletionTimestamp。
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface PodRow { namespace: string; name: string; ip: string; hostNetwork?: boolean }

function fixture(pods: PodRow[]) {
  const root = mkdtempSync(join(tmpdir(), 'cs-calico-cni-'));
  roots.push(root);
  mkdirSync(join(root, 'deploy/local'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  copyFileSync(join(import.meta.dir, 'calico-cni.sh'), join(root, 'deploy/local/calico-cni.sh'));
  writeFileSync(join(root, 'deploy/local/lib.sh'), `set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
NODE_CONTAINER=test-node
kc() { kubectl "$@"; }
node_exec() { printf '%s\\n' "$*" >> "$TEST_ROOT/node.log"; }
log() { printf '\\n==> %s\\n' "$*"; }
warn() { printf 'WARN: %s\\n' "$*" >&2; }
check_environment() { :; }
require_tool() { :; }
`);
  const items = pods.map((p) => ({ metadata: { namespace: p.namespace, name: p.name }, spec: p.hostNetwork ? { hostNetwork: true } : {}, status: { podIP: p.ip } }));
  writeFileSync(join(root, 'pods.json'), JSON.stringify({ items }));
  writeFileSync(join(root, 'deleted'), '');
  const executable = (name: string, body: string) => {
    writeFileSync(join(root, name), `#!/bin/bash\nset -eu\n${body}\n`);
    chmodSync(join(root, name), 0o755);
  };
  executable('bin/kubectl', `
printf '%s\\n' "$*" >> "$TEST_ROOT/kubectl.log"
if [ "\${3:-}" = delete ] && [ "\${4:-}" = pod ]; then echo "$5" >> "$TEST_ROOT/deleted"; exit 0; fi
case "$*" in
  *'get pods -A -o json'*) jq --rawfile deleted "$TEST_ROOT/deleted" '.items |= map(if (.metadata.name | IN($deleted | split("\\n")[])) then .metadata.deletionTimestamp = "2026-09-23T10:00:00Z" else . end)' "$TEST_ROOT/pods.json" ;;
  *'get node '*) echo "\${TEST_POD_CIDR:-10.244.0.0/24}" ;;
  *'get daemonset kindnet'*) exit 1 ;;
  *'get daemonset calico-node'*) echo 'calico/node:test' ;;
  *'get ippools'*) echo '10.244.128.0/17' ;;
esac`);
  executable('bin/bun', `echo 'kind: List'`);
  return root;
}

async function run(root: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(['bash', join(root, 'deploy/local/calico-cni.sh')], { env: { PATH: `${root}/bin:${Bun.env.PATH}`, TEST_ROOT: root, ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const read = (name: string) => (existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : '');
  return { code, out, err, kubectl: read('kubectl.log'), node: read('node.log') };
}

describe('calico-cni.sh 的旧网段判定', () => {
  test('第一次跑：删掉旧网段的系统 Pod 以后，正在终止的不再挡着，同一次就删掉 kindnet 的地址转换链', async () => {
    const root = fixture([
      { namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' },
      { namespace: 'local-path-storage', name: 'provisioner-old', ip: '10.244.0.6' },
      { namespace: 'kube-system', name: 'coredns-new', ip: '10.244.130.2' },
      { namespace: 'kube-system', name: 'kube-proxy', ip: '10.244.0.2', hostNetwork: true },
    ]);
    const result = await run(root);
    expect(result.code).toBe(0);
    expect(result.kubectl).toContain('-n kube-system delete pod coredns-old --wait=false');
    expect(result.kubectl).toContain('-n local-path-storage delete pod provisioner-old --wait=false');
    expect(result.kubectl).not.toContain('delete pod coredns-new');
    expect(result.kubectl).not.toContain('delete pod kube-proxy');
    expect(result.node).toContain('iptables-save -t nat');
    expect(result.out).toContain('kindnet masquerade chain: removed');
    expect(result.err).not.toContain('still use kindnet addresses');
  });

  test('别的命名空间里还活在旧网段的 Pod 挡住删链，逐个列出；命名空间按整名匹配，不按子串', async () => {
    const root = fixture([
      { namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' },
      { namespace: 'cs-demo', name: 'task-a', ip: '10.244.0.9' },
      { namespace: 'local', name: 'lookalike', ip: '10.244.0.11' },
    ]);
    const result = await run(root);
    expect(result.code).toBe(0);
    expect(result.kubectl).toContain('-n kube-system delete pod coredns-old --wait=false');
    expect(result.kubectl).not.toContain('delete pod task-a');
    expect(result.kubectl).not.toContain('delete pod lookalike');
    expect(result.err).toContain('still use kindnet addresses');
    expect(result.err).toContain('cs-demo task-a');
    expect(result.err).toContain('local lookalike');
    expect(result.err).not.toContain('coredns-old');
    expect(result.node).not.toContain('iptables');
  });

  test('节点网段不是 /24 时不猜旧地址：只装 Calico、删 kindnet，不删 Pod 也不动地址转换链', async () => {
    const root = fixture([{ namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' }]);
    const result = await run(root, { TEST_POD_CIDR: '10.244.0.0/16' });
    expect(result.code).toBe(0);
    expect(result.err).toContain('is not a /24');
    expect(result.kubectl).toContain('apply --server-side --force-conflicts');
    expect(result.kubectl).not.toContain('delete pod');
    expect(result.node).toContain('10-kindnet.conflist');
    expect(result.node).not.toContain('iptables');
  });
});
