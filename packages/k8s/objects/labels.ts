/** 平台对象统一标签；Pod 身份索引与日志采集都按这些标签识别。 */
export const LABELS = {
  managedBy: 'app.kubernetes.io/managed-by',
  component: 'app.kubernetes.io/component',
  project: 'crewstation.io/project',
  service: 'crewstation.io/service',
  slot: 'crewstation.io/slot',
  workload: 'crewstation.io/workload',
  task: 'crewstation.io/task',
  release: 'crewstation.io/release',
} as const;

export const MANAGED_BY = 'crewstation';

export function platformLabels(extra: Record<string, string> = {}): Record<string, string> {
  return { [LABELS.managedBy]: MANAGED_BY, ...extra };
}
