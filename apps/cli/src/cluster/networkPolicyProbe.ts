import type { ClusterAccess, ClusterResult } from './clusterAccess';
import { firstProblem, ok } from './clusterAccess';
import type { CheckLine, OperatorContext } from './installReport';
import { checkLine as line } from './installReport';

/**
 * 安装与升级预检实测网络插件确实执行 NetworkPolicy（Design D60）。项目命名空间的出站隔离（D54）全靠它，
 * 而插件不执行时策略照样建得出来、只是不生效——只有实测看得出来。
 *
 * 在一个临时命名空间里放一个应答端和两个一次性探针：套了禁止出站策略的必须连不上，没套的必须连得上
 *（与 deploy/local/verify.sh 的 E 项同一个判法）。探针直接连应答端的 Pod IP，不经 DNS；
 * 探针总是正常退出，只把 connected／blocked 打进日志，等两个都结束后按日志判定。无论结果如何，最后删掉整个命名空间。
 */
export const PROBE_LABEL = 'crewstation.io/preflight-probe';
const LABEL = 'NetworkPolicy 实测（D60）';
const WAIT = '--timeout=120s';

const SERVER = "Bun.serve({ port: 8080, fetch: () => new Response('ok') });";
const CLIENT = "try { await fetch(process.env.TARGET, { signal: AbortSignal.timeout(5000) }); console.log('connected'); } catch { console.log('blocked'); }";

/** 发行包 release.lock.yaml 里的控制面镜像（含 bun）；探针与应答端都用它，不另拉公网镜像。 */
export function probeImage(images: readonly string[]): string | undefined {
  return images.find((ref) => (ref.split('@')[0] ?? '').replace(/:[^/:]+$/, '').endsWith('control-plane'));
}

function pod(namespace: string, name: string, image: string, role: string, script: string, extra: Record<string, unknown> = {}) {
  return {
    apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace, labels: { [PROBE_LABEL]: role } },
    spec: {
      // bun 作为 1 号进程不处理 SIGTERM，不设的话删命名空间要等满 30 秒的优雅退出期。
      restartPolicy: 'Never', automountServiceAccountToken: false, terminationGracePeriodSeconds: 1,
      containers: [{
        name: 'probe', image, command: ['bun', '-e', script], env: [{ name: 'HOME', value: '/tmp' }], ...extra,
        resources: { requests: { cpu: '10m', memory: '32Mi' }, limits: { cpu: '200m', memory: '128Mi' } },
        securityContext: { runAsNonRoot: true, runAsUser: 65534, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
      }],
    },
  };
}

export function targetManifest(namespace: string, image: string): string {
  return JSON.stringify({
    apiVersion: 'v1', kind: 'List', items: [
      { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { 'app.kubernetes.io/managed-by': 'crewstation', [PROBE_LABEL]: 'namespace' } } },
      { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: { name: 'deny-egress', namespace }, spec: { podSelector: { matchLabels: { [PROBE_LABEL]: 'denied' } }, policyTypes: ['Egress'] } },
      pod(namespace, 'np-target', image, 'target', SERVER, { ports: [{ containerPort: 8080 }], readinessProbe: { tcpSocket: { port: 8080 }, periodSeconds: 1 } }),
    ],
  });
}

export function clientsManifest(namespace: string, image: string, targetIp: string): string {
  const env = [{ name: 'HOME', value: '/tmp' }, { name: 'TARGET', value: `http://${targetIp}:8080/` }];
  return JSON.stringify({ apiVersion: 'v1', kind: 'List', items: [pod(namespace, 'np-allowed', image, 'allowed', CLIENT, { env }), pod(namespace, 'np-denied', image, 'denied', CLIENT, { env })] });
}

/** 两个探针的日志 → 结论。只有「对照连得上、受限的连不上」才算通过。 */
export function judgeProbe(allowed: string, denied: string): CheckLine {
  if (!allowed.includes('connected')) return line(LABEL, 'failed', '没套策略的对照探针也连不上应答端：集群网络本身不通，判断不了 NetworkPolicy');
  if (!denied.includes('blocked')) return line(LABEL, 'failed', '套了禁止出站策略的探针仍连得上：网络插件没有执行 NetworkPolicy，项目命名空间的出站隔离（D54）不会生效');
  return line(LABEL, 'ok', '套了禁止出站策略的探针连不上，对照探针连得上');
}

async function step(cluster: ClusterAccess, what: string, args: readonly string[], input?: string): Promise<ClusterResult> {
  const result = await cluster.run(args, input);
  if (!ok(result)) throw new Error(`${what}：${firstProblem(result)}`);
  return result;
}

async function runProbe(cluster: ClusterAccess, namespace: string, image: string): Promise<CheckLine> {
  const ns = ['-n', namespace];
  await step(cluster, '下发应答端与禁止出站策略', ['apply', '-f', '-'], targetManifest(namespace, image));
  await step(cluster, '等应答端就绪', [...ns, 'wait', '--for=condition=Ready', 'pod/np-target', WAIT]);
  const ip = (await step(cluster, '读应答端地址', [...ns, 'get', 'pod', 'np-target', '-o', 'jsonpath={.status.podIP}'])).stdout.trim();
  if (!ip) throw new Error('应答端没有 Pod IP');
  await step(cluster, '下发两个探针', ['apply', '-f', '-'], clientsManifest(namespace, image, ip));
  await step(cluster, '等两个探针结束', [...ns, 'wait', '--for=jsonpath={.status.phase}=Succeeded', 'pod/np-allowed', 'pod/np-denied', WAIT]);
  const allowed = (await step(cluster, '读对照探针的结果', [...ns, 'logs', 'np-allowed'])).stdout;
  const denied = (await step(cluster, '读受限探针的结果', [...ns, 'logs', 'np-denied'])).stdout;
  return judgeProbe(allowed, denied);
}

export async function networkPolicyCheck(ctx: OperatorContext, suffix: string = crypto.randomUUID().slice(0, 8)): Promise<CheckLine> {
  const image = probeImage(ctx.bundle.images);
  if (image === undefined) return line(LABEL, 'pending-config', '发行包 release.lock.yaml 里没有控制面镜像（名字以 control-plane 结尾），下发不了探针');
  const namespace = `crewstation-preflight-${suffix}`;
  if (ctx.dryRun) return line(LABEL, 'skipped', `--dry-run：将在临时命名空间 ${namespace} 放一个应答端和两个探针（其中一个套禁止出站策略），实测后删除`);
  try {
    return await runProbe(ctx.cluster, namespace, image);
  } catch (error) {
    return line(LABEL, 'failed', `${error instanceof Error ? error.message : String(error)}（临时命名空间 ${namespace}）`);
  } finally {
    await ctx.cluster.run(['delete', 'namespace', namespace, '--wait=false', '--ignore-not-found']);
  }
}
