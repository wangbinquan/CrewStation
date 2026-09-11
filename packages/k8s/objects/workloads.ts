import type { K8sObject } from '../resources';
import { platformLabels } from './labels';

export type EnvVar = { name: string; value: string } | { name: string; valueFrom: { secretKeyRef: { name: string; key: string } } };
export interface ResourceSpec { cpu: string; memory: string; ephemeralStorage?: string }
export interface VolumeSpec { name: string; mountPath: string; pvc?: string; emptyDir?: boolean; readOnly?: boolean }

export interface ContainerSpec {
  name: string;
  image: string;
  command?: string[];
  args?: string[];
  env?: EnvVar[];
  port?: number;
  healthPath?: string;
  resources?: ResourceSpec;
  volumes?: VolumeSpec[];
  workingDir?: string;
  runAsUser?: number;
  imagePullPolicy?: 'Always' | 'IfNotPresent';
}

export interface WorkloadSpec extends ContainerSpec {
  namespace: string;
  labels: Record<string, string>;
  serviceAccountName?: string;
  automountServiceAccountToken?: boolean;
  /** 主容器启动前按顺序跑完；凭据只进 init 容器，长驻容器的环境里就没有它。 */
  initContainers?: ContainerSpec[];
}

function container(spec: ContainerSpec): Record<string, unknown> {
  const probes = spec.port && spec.healthPath
    ? {
      readinessProbe: { httpGet: { path: spec.healthPath, port: spec.port }, periodSeconds: 5, failureThreshold: 3 },
      livenessProbe: { httpGet: { path: spec.healthPath, port: spec.port }, periodSeconds: 10, failureThreshold: 6, initialDelaySeconds: 10 },
    }
    : {};
  return {
    name: spec.name,
    image: spec.image,
    imagePullPolicy: spec.imagePullPolicy ?? 'IfNotPresent',
    ...(spec.command ? { command: spec.command } : {}),
    ...(spec.args ? { args: spec.args } : {}),
    ...(spec.workingDir ? { workingDir: spec.workingDir } : {}),
    env: spec.env ?? [],
    ...(spec.port ? { ports: [{ containerPort: spec.port, name: 'http' }] } : {}),
    ...probes,
    ...(spec.resources ? { resources: { requests: requestsOf(spec.resources), limits: requestsOf(spec.resources) } } : {}),
    volumeMounts: (spec.volumes ?? []).map((v) => ({ name: v.name, mountPath: v.mountPath, readOnly: v.readOnly ?? false })),
    ...(spec.runAsUser !== undefined ? { securityContext: { runAsUser: spec.runAsUser, allowPrivilegeEscalation: false } } : {}),
  };
}

function requestsOf(r: ResourceSpec): Record<string, string> {
  return { cpu: r.cpu, memory: r.memory, ...(r.ephemeralStorage ? { 'ephemeral-storage': r.ephemeralStorage } : {}) };
}

function volumes(spec: WorkloadSpec): unknown[] {
  return (spec.volumes ?? []).map((v) => (v.pvc ? { name: v.name, persistentVolumeClaim: { claimName: v.pvc } } : { name: v.name, emptyDir: {} }));
}

export function podTemplate(spec: WorkloadSpec): Record<string, unknown> {
  return {
    metadata: { labels: platformLabels(spec.labels) },
    spec: {
      ...(spec.serviceAccountName ? { serviceAccountName: spec.serviceAccountName } : {}),
      automountServiceAccountToken: spec.automountServiceAccountToken ?? false,
      ...(spec.initContainers?.length ? { initContainers: spec.initContainers.map(container) } : {}),
      containers: [container(spec)],
      volumes: volumes(spec),
    },
  };
}

export function deploymentObject(spec: WorkloadSpec & { replicas: number; selector: Record<string, string> }): K8sObject {
  return {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels) },
    spec: {
      replicas: spec.replicas,
      selector: { matchLabels: spec.selector },
      template: { ...podTemplate(spec), metadata: { labels: platformLabels({ ...spec.labels, ...spec.selector }) } },
      strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
    },
  };
}

/** 任务容器：一个长驻 Pod，restartPolicy Never，Pod 消失即任务失败或释放。 */
export function podObject(spec: WorkloadSpec): K8sObject {
  const template = podTemplate(spec);
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels) },
    spec: { ...(template.spec as Record<string, unknown>), restartPolicy: 'Never', terminationGracePeriodSeconds: 30 },
  };
}

export function jobObject(spec: WorkloadSpec & { backoffLimit?: number; ttlSecondsAfterFinished?: number; activeDeadlineSeconds?: number }): K8sObject {
  const template = podTemplate(spec);
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: { name: spec.name, namespace: spec.namespace, labels: platformLabels(spec.labels) },
    spec: {
      backoffLimit: spec.backoffLimit ?? 0,
      ttlSecondsAfterFinished: spec.ttlSecondsAfterFinished ?? 3600,
      ...(spec.activeDeadlineSeconds ? { activeDeadlineSeconds: spec.activeDeadlineSeconds } : {}),
      template: { ...template, spec: { ...(template.spec as Record<string, unknown>), restartPolicy: 'Never' } },
    },
  };
}
