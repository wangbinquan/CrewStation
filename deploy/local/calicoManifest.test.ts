import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CALICO_MANIFEST_SHA256, CALICO_POOL_CIDR, customizeCalicoManifest, manifestSha256 } from './calico-manifest';

const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** 官方清单里三处锚点的原样片段（v3.32.2 calico-node 容器的 env）。 */
const UPSTREAM = [
  'kind: DaemonSet',
  '          env:',
  '            - name: IP',
  '              value: "autodetect"',
  '            - name: CALICO_IPV4POOL_IPIP',
  '              value: "Always"',
  '            - name: CALICO_IPV4POOL_VXLAN',
  '              value: "Never"',
  '            # - name: CALICO_IPV4POOL_CIDR',
  '            #   value: "192.168.0.0/16"',
  '            - name: CALICO_DISABLE_FILE_LOGGING',
  '              value: "true"',
  '',
].join('\n');

const ipv4 = (address: string) => address.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
const range = (cidr: string) => { const [base, bits] = cidr.split('/'); const size = 2 ** (32 - Number(bits)); const start = ipv4(base!); return { start, end: start + size - 1 }; };

test('三处本机定制各生效一次：按 InternalIP 取节点地址、关掉 IPIP、地址池取消注释并换成本机网段', () => {
  const out = customizeCalicoManifest(UPSTREAM);
  expect(out).toContain('            - name: IP_AUTODETECTION_METHOD\n              value: "kubernetes-internal-ip"\n');
  expect(out).toContain('            - name: CALICO_IPV4POOL_IPIP\n              value: "Never"\n');
  expect(out).toContain(`            - name: CALICO_IPV4POOL_CIDR\n              value: "${CALICO_POOL_CIDR}"\n`);
  expect(out).not.toContain('value: "Always"');
  expect(out).not.toContain('# - name: CALICO_IPV4POOL_CIDR');
  // 其余内容原样保留。
  expect(out).toContain('            - name: CALICO_IPV4POOL_VXLAN\n              value: "Never"\n');
  expect(out.split('\n').length).toBe(UPSTREAM.split('\n').length + 2);
});

test('锚点缺失或重复（上游结构变了、或拿已定制过的清单再定制）时停下，不装猜出来的清单', () => {
  expect(() => customizeCalicoManifest(UPSTREAM.replace('value: "Always"', 'value: "CrossSubnet"'))).toThrow('锚点出现 0 次');
  expect(() => customizeCalicoManifest(customizeCalicoManifest(UPSTREAM))).toThrow('Calico 清单的结构和 v3.32.2 不一致');
  expect(() => customizeCalicoManifest(UPSTREAM + UPSTREAM)).toThrow('锚点出现 2 次');
});

test('地址池在 kube-proxy 的 clusterCIDR 之内（集群内不做源地址转换），并避开 kindnet 用过的节点网段', () => {
  const pool = range(CALICO_POOL_CIDR), cluster = range('10.244.0.0/16'), kindnet = range('10.244.0.0/24');
  expect(pool.start >= cluster.start && pool.end <= cluster.end).toBe(true);
  expect(pool.end < kindnet.start || pool.start > kindnet.end).toBe(true);
});

test('命令行：校验和不符时拒绝输出，退出码 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-calico-')); directories.push(dir);
  const file = join(dir, 'calico.yaml'); writeFileSync(file, UPSTREAM);
  expect(manifestSha256(UPSTREAM)).not.toBe(CALICO_MANIFEST_SHA256);
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'calico-manifest.ts'), '--file', file], { stdout: 'pipe', stderr: 'pipe' });
  const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).toBe(1); expect(out).toBe(''); expect(error).toContain('Calico 清单校验和不符');
});
