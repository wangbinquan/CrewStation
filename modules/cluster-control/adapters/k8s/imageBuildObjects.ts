import type { RuntimeImageBuildRender } from '@crewstation/contracts';
import type { K8sObject } from '@crewstation/k8s';
import { LABELS, MANAGED_BY, secretObject } from '@crewstation/k8s';

const labels = (plan: RuntimeImageBuildRender) => ({ [LABELS.managedBy]: MANAGED_BY, [LABELS.component]: 'build', [LABELS.project]: plan.projectSlug, 'crewstation.io/resource-id': plan.resourceId, 'crewstation.io/image-build': plan.buildId, 'crewstation.io/build-epoch': String(plan.executionEpoch) });
const limits = (value: RuntimeImageBuildRender['builderResources']) => ({ requests: { cpu: value.cpu, memory: value.memory, 'ephemeral-storage': value.ephemeralStorage }, limits: { cpu: value.cpu, memory: value.memory, 'ephemeral-storage': value.ephemeralStorage } });
const mount = (name: string, mountPath: string, readOnly = false) => ({ name, mountPath, readOnly });

/** 每个 build 独占 rootless daemon＋client，socket／缓存／上下文仅在本 Pod emptyDir；不挂宿主或业务 PVC。 */
export function imageBuildJobObject(plan: RuntimeImageBuildRender): K8sObject {
  const secretVolume = (name: string, items: { key: string; path: string }[]) => ({ name, secret: { secretName: plan.secret, defaultMode: 0o440, items } });
  const clientSecurity = { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } };
  return { apiVersion: 'batch/v1', kind: 'Job', metadata: { name: plan.name, namespace: plan.namespace, labels: labels(plan) }, spec: {
    backoffLimit: 0, activeDeadlineSeconds: plan.activeDeadlineSeconds, ttlSecondsAfterFinished: plan.ttlSecondsAfterFinished,
    template: { metadata: { labels: labels(plan) }, spec: {
      automountServiceAccountToken: false, restartPolicy: 'Never', terminationGracePeriodSeconds: 30,
      nodeSelector: { 'kubernetes.io/arch': plan.architecture.split('/')[1] }, securityContext: { fsGroup: 1000 },
      volumes: [
        { name: 'workspace', emptyDir: { sizeLimit: plan.workspaceSize } }, { name: 'cache', emptyDir: { sizeLimit: plan.cacheSize } }, { name: 'socket', emptyDir: { medium: 'Memory', sizeLimit: '16Mi' } },
        secretVolume('git', [{ key: 'git-token', path: 'token' }]), secretVolume('push', [{ key: 'docker-config', path: 'config.json' }]),
        ...(plan.secretIds.length ? [secretVolume('packages', plan.secretIds.map((id) => ({ key: `package-${id}`, path: id })))] : []),
      ],
      initContainers: [{ name: 'checkout', image: plan.clientImage, command: plan.checkoutCommand, securityContext: clientSecurity, resources: limits(plan.clientResources), env: [{ name: 'HOME', value: '/tmp' }], volumeMounts: [mount('workspace', '/workspace'), mount('git', '/git-auth', true)] }],
      containers: [
        { name: 'buildkitd', image: plan.builderImage, command: plan.daemonCommand,
          securityContext: { runAsNonRoot: true, runAsUser: 1000, runAsGroup: 1000, privileged: false, seccompProfile: { type: 'Unconfined' }, appArmorProfile: { type: 'Unconfined' } },
          resources: limits(plan.builderResources), volumeMounts: [mount('cache', '/home/user/.local/share/buildkit'), mount('socket', '/run/cs-build')],
        },
        { name: 'buildctl', image: plan.clientImage, command: plan.clientCommand, securityContext: clientSecurity, resources: limits(plan.clientResources),
          env: [{ name: 'DOCKER_CONFIG', value: '/push-auth' }, { name: 'HOME', value: '/tmp' }], terminationMessagePath: '/tmp/build-result.json', terminationMessagePolicy: 'File',
          volumeMounts: [mount('workspace', '/workspace', true), mount('socket', '/run/cs-build'), mount('push', '/push-auth', true), ...(plan.secretIds.length ? [mount('packages', '/build-secrets', true)] : [])],
        },
      ],
    } },
  } };
}

export function imageBuildSecretObject(plan: RuntimeImageBuildRender, values: Readonly<Record<string, string>>): K8sObject {
  return { ...secretObject({ name: plan.secret, namespace: plan.namespace, labels: labels(plan), stringData: { ...values } }), immutable: true } as K8sObject;
}
