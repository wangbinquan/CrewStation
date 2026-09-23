import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// calico-cni.sh 的编排与旧网段判定：kubectl、节点命令与 bun 打桩，jq 用真的（脚本本来就依赖它）。
// 打桩的 kubectl 模拟 `delete --wait=false` 的真实效果：被删的 Pod 仍在列表里，只是带上 deletionTimestamp。
// 打桩的重建工具（rebuild-old-range-pods.ts）按 TEST_REBUILD 决定删掉哪些 Pod、用什么退出码。
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

interface PodRow { namespace: string; name: string; ip: string; hostNetwork?: boolean; phase?: string }

function fixture(pods: PodRow[]) {
  const root = mkdtempSync(join(tmpdir(), 'cs-calico-cni-'));
  roots.push(root);
  mkdirSync(join(root, 'deploy/local'), { recursive: true });
  mkdirSync(join(root, 'bin'));
  copyFileSync(join(import.meta.dir, 'calico-cni.sh'), join(root, 'deploy/local/calico-cni.sh'));
  writeFileSync(join(root, 'deploy/local/lib.sh'), `set -euo pipefail
DEPLOY_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"
NODE_CONTAINER=test-node
KUBE_CONTEXT=test-context
kc() { kubectl "$@"; }
node_exec() { printf '%s\\n' "$*" >> "$TEST_ROOT/node.log"; }
log() { printf '\\n==> %s\\n' "$*"; }
warn() { printf 'WARN: %s\\n' "$*" >&2; }
check_environment() { :; }
require_tool() { :; }
`);
  const items = pods.map((p) => ({ metadata: { namespace: p.namespace, name: p.name }, spec: p.hostNetwork ? { hostNetwork: true } : {}, status: { podIP: p.ip, phase: p.phase ?? 'Running' } }));
  writeFileSync(join(root, 'pods.json'), JSON.stringify({ items }));
  writeFileSync(join(root, 'deleted'), '');
  const executable = (name: string, body: string) => {
    writeFileSync(join(root, name), `#!/bin/bash\nset -eu\n${body}\n`);
    chmodSync(join(root, name), 0o755);
  };
  executable('bin/kubectl', `
printf '%s\\n' "$*" >> "$TEST_ROOT/kubectl.log"
case "$*" in
  *'get pods -A -o json'*) jq --rawfile deleted "$TEST_ROOT/deleted" '.items |= map(if (.metadata.name | IN($deleted | split("\\n")[])) then .metadata.deletionTimestamp = "2026-09-23T10:00:00Z" else . end)' "$TEST_ROOT/pods.json" ;;
  *'get node '*) echo "\${TEST_POD_CIDR:-10.244.0.0/24}" ;;
  *'get daemonset kindnet'*) [ "\${TEST_KINDNET:-0}" = 1 ] || exit 1 ;;
  *'get daemonset calico-node'*numberReady*) [ "\${TEST_CALICO_READY:-1/1}" = absent ] && exit 1; echo "\${TEST_CALICO_READY:-1/1}" ;;
  *'get daemonset calico-node'*) echo 'calico/node:test' ;;
  *'get ippools'*) echo '10.244.128.0/17' ;;
esac`);
  // 桩：清单生成器照常输出；重建工具记下参数，把 TEST_REBUILD 点名的 Pod 标成已删，再按 TEST_REBUILD_EXIT 退出。
  executable('bin/bun', `
case "$*" in
  *calico-manifest.ts*) echo 'kind: List' ;;
  *rebuild-old-range-pods.ts*)
    printf '%s\\n' "$*" >> "$TEST_ROOT/rebuild.log"
    for name in \${TEST_REBUILD:-}; do echo "$name" >> "$TEST_ROOT/deleted"; done
    exit "\${TEST_REBUILD_EXIT:-0}" ;;
esac`);
  return root;
}

async function run(root: string, env: Record<string, string> = {}, args: string[] = []) {
  const child = Bun.spawn(['bash', join(root, 'deploy/local/calico-cni.sh'), ...args], { env: { PATH: `${root}/bin:${Bun.env.PATH}`, TEST_ROOT: root, ...env }, stdout: 'pipe', stderr: 'pipe' });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const read = (name: string) => (existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : '');
  return { code, out, err, kubectl: read('kubectl.log'), node: read('node.log'), rebuild: read('rebuild.log') };
}

describe('calico-cni.sh 迁移', () => {
  test('装 Calico、删 kindnet、交给重建工具处理旧网段；重建完旧地址上没有 Pod 了，同一次就删掉 kindnet 的地址转换链', async () => {
    const root = fixture([
      { namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' },
      { namespace: 'cs-demo', name: 'task-r-1', ip: '10.244.0.9' },
      { namespace: 'kube-system', name: 'coredns-new', ip: '10.244.130.2' },
      { namespace: 'kube-system', name: 'kube-proxy', ip: '10.244.0.2', hostNetwork: true },
      { namespace: 'crewstation-system', name: 'migrate-done', ip: '10.244.0.30', phase: 'Succeeded' },
    ]);
    const result = await run(root, { TEST_REBUILD: 'coredns-old task-r-1' });
    expect(result.code).toBe(0);
    expect(result.kubectl).toContain('apply --server-side --force-conflicts');
    expect(result.node).toContain('10-kindnet.conflist');
    expect(result.rebuild.trim()).toEndWith('deploy/local/rebuild-old-range-pods.ts --prefix 10.244.0. --context test-context');
    expect(result.node).toContain('iptables-save -t nat');
    expect(result.out).toContain('kindnet masquerade chain: removed');
    expect(result.err).not.toContain('still use kindnet addresses');
  });

  test('重建工具留下了 Pod（退出码 2）：不算失败，逐个列出，保留地址转换链；命名空间按整名匹配', async () => {
    const root = fixture([
      { namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' },
      { namespace: 'cs-demo', name: 'task-a', ip: '10.244.0.9' },
      { namespace: 'local', name: 'lookalike', ip: '10.244.0.11' },
    ]);
    const result = await run(root, { TEST_REBUILD: 'coredns-old', TEST_REBUILD_EXIT: '2' });
    expect(result.code).toBe(0);
    expect(result.err).toContain('still use kindnet addresses');
    expect(result.err).toContain('cs-demo task-a');
    expect(result.err).toContain('local lookalike');
    expect(result.err).not.toContain('coredns-old');
    expect(result.node).not.toContain('iptables');
  });

  test('重建工具出错（退出码不是 0 或 2）：脚本失败，不动地址转换链', async () => {
    const root = fixture([{ namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' }]);
    const result = await run(root, { TEST_REBUILD_EXIT: '1' });
    expect(result.code).toBe(1);
    expect(result.node).not.toContain('iptables');
  });

  test('节点网段不是 /24 时不猜旧地址：只装 Calico、删 kindnet，不调重建工具，也不动地址转换链', async () => {
    const root = fixture([{ namespace: 'kube-system', name: 'coredns-old', ip: '10.244.0.5' }]);
    const result = await run(root, { TEST_POD_CIDR: '10.244.0.0/16' });
    expect(result.code).toBe(0);
    expect(result.err).toContain('is not a /24');
    expect(result.kubectl).toContain('apply --server-side --force-conflicts');
    expect(result.rebuild).toBe('');
    expect(result.node).toContain('10-kindnet.conflist');
    expect(result.node).not.toContain('iptables');
  });
});

describe('calico-cni.sh --check（install-platform.sh 先调它）', () => {
  const settled: PodRow[] = [
    { namespace: 'kube-system', name: 'coredns-new', ip: '10.244.130.2' },
    { namespace: 'crewstation-system', name: 'migrate-done', ip: '10.244.0.30', phase: 'Succeeded' },
    { namespace: 'kube-system', name: 'kube-proxy', ip: '10.244.0.2', hostNetwork: true },
  ];

  test('已是 Calico、旧网段上只剩结束的与 hostNetwork 的 Pod：退出码 0，什么都不改', async () => {
    const root = fixture(settled);
    const result = await run(root, {}, ['--check']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('network plugin: Calico');
    expect(result.kubectl).not.toContain('apply');
    expect(result.kubectl).not.toContain('delete');
    expect(result.node).toBe('');
    expect(result.rebuild).toBe('');
  });

  test('kindnet 还在、calico-node 没就绪、旧地址上还有在跑的 Pod：退出码 10，三条原因写成一行', async () => {
    const root = fixture([...settled, { namespace: 'cs-demo', name: 'task-a', ip: '10.244.0.9' }]);
    const result = await run(root, { TEST_KINDNET: '1', TEST_CALICO_READY: '0/1' }, ['--check']);
    expect(result.code).toBe(10);
    expect(result.out).toContain('kindnet DaemonSet 还在');
    expect(result.out).toContain('calico-node 没有全部就绪（0/1）');
    expect(result.out).toContain('1 个 Pod 还用着旧地址（10.244.0.0/24）');
    expect(result.kubectl).not.toContain('apply');
    expect(result.node).toBe('');
  });

  test('没装 Calico（DaemonSet 不存在）也算要迁移', async () => {
    const root = fixture(settled);
    const result = await run(root, { TEST_CALICO_READY: 'absent' }, ['--check']);
    expect(result.code).toBe(10);
    expect(result.out).toContain('calico-node 没有全部就绪（不存在）');
  });
});
