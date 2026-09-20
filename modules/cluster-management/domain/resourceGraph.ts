import type { ClusterOwnership } from '@crewstation/contracts';
import type { InventoryFacts, ResourceObject, SystemComponent } from './inventory';
import { objectArray, objectRecord, resourceKey } from './inventory';

export function referencesOf(obj: ResourceObject): string[] {
  const ns = obj.metadata.namespace ?? '', spec = objectRecord(obj.spec);
  const template = obj.kind === 'CronJob' ? objectRecord(objectRecord(spec.jobTemplate).spec) : spec;
  const pod = obj.kind === 'Pod' ? spec : objectRecord(objectRecord(template.template).spec);
  const keys = new Set<string>();
  const add = (kind: string, name: unknown) => { if (typeof name === 'string' && name) keys.add(`${ns}/${kind}/${name}`); };
  for (const v of objectArray(pod.volumes)) {
    add('PersistentVolumeClaim', objectRecord(v.persistentVolumeClaim).claimName);
    add('Secret', objectRecord(v.secret).secretName); add('ConfigMap', objectRecord(v.configMap).name);
    for (const s of objectArray(objectRecord(v.projected).sources)) { add('Secret', objectRecord(s.secret).name); add('ConfigMap', objectRecord(s.configMap).name); }
  }
  for (const c of [...objectArray(pod.containers), ...objectArray(pod.initContainers)]) {
    for (const env of objectArray(c.env)) { const from = objectRecord(env.valueFrom); add('Secret', objectRecord(from.secretKeyRef).name); add('ConfigMap', objectRecord(from.configMapKeyRef).name); }
    for (const env of objectArray(c.envFrom)) { add('Secret', objectRecord(env.secretRef).name); add('ConfigMap', objectRecord(env.configMapRef).name); }
  }
  if (Object.keys(pod).length) add('ServiceAccount', pod.serviceAccountName ?? 'default');
  for (const v of objectArray(pod.imagePullSecrets)) add('Secret', v.name);
  for (const route of objectArray(spec.routes)) {
    for (const svc of objectArray(route.services)) add('Service', svc.name);
    for (const mid of objectArray(route.middlewares)) add('Middleware', mid.name);
  }
  add('Secret', objectRecord(spec.tls).secretName);
  if (obj.kind === 'ServiceAccount') for (const s of [...objectArray(obj.secrets), ...objectArray(obj.imagePullSecrets)]) add('Secret', s.name);
  if (obj.kind === 'StatefulSet') for (const claim of objectArray(spec.volumeClaimTemplates)) for (let i = 0; i < Math.min(1000, Number(spec.replicas ?? 1)); i++) add('PersistentVolumeClaim', `${objectRecord(claim.metadata).name}-${obj.metadata.name}-${i}`);
  if (obj.kind === 'Ingress') for (const tls of objectArray(spec.tls)) add('Secret', tls.secretName);
  if (obj.kind === 'Ingress') for (const rule of objectArray(spec.rules)) for (const path of objectArray(objectRecord(rule.http).paths)) add('Service', objectRecord(objectRecord(path.backend).service).name);
  return [...keys];
}

export function resourceGraph(objects: ResourceObject[], facts: InventoryFacts, systemNamespace: string, catalog: SystemComponent[]) {
  const byUid = new Map(objects.filter((o) => o.metadata.uid).map((o) => [o.metadata.uid!, o]));
  const byKey = new Map(objects.map((o) => [resourceKey(o), o]));
  const system = new Map<string, SystemComponent>();
  for (const obj of objects) if ((obj.metadata.namespace ?? obj.metadata.name) === systemNamespace) {
    const entry = catalog.find((c) => c.kind === obj.kind && c.name === obj.metadata.name);
    if (entry) system.set(obj.metadata.uid!, entry);
  }
  const owner = (obj: ResourceObject): ResourceObject | undefined => {
    const ref = obj.metadata.ownerReferences?.find((o) => o.controller);
    const parent = ref ? byUid.get(ref.uid) : undefined;
    return parent && ref && parent.kind === ref.kind && parent.apiVersion === ref.apiVersion && parent.metadata.name === ref.name && parent.metadata.namespace === obj.metadata.namespace ? parent : undefined;
  };
  // Fixed point: registered roots -> controller descendants -> actual referenced configuration / claims.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const obj of objects) {
      const parent = owner(obj), entry = system.get(obj.metadata.uid!) ?? (parent ? system.get(parent.metadata.uid!) : undefined);
      if (!entry) continue;
      if (!system.has(obj.metadata.uid!)) { system.set(obj.metadata.uid!, entry); changed = true; }
      for (const key of referencesOf(obj)) {
        const target = byKey.get(key);
        if (target?.metadata.namespace === systemNamespace && !system.has(target.metadata.uid!)) { system.set(target.metadata.uid!, entry); changed = true; }
      }
    }
    if (!changed) break;
  }
  const ownership = (obj: ResourceObject): ClusterOwnership | undefined => {
    const ns = obj.kind === 'Namespace' ? obj.metadata.name : obj.metadata.namespace;
    const task = facts.tasks.find((t) => t.namespace === ns && t.podName === obj.metadata.name && (!!t.podUid && t.podUid === obj.metadata.uid));
    if (obj.kind === 'Pod' && task?.kind === 'profile-test') return { scope: 'system', component: 'profile-test' };
    const project = facts.projects.find((p) => p.namespace === ns), label = obj.metadata.labels?.['crewstation.io/project'];
    if (project) return label && label !== project.slug ? { scope: 'unresolved', reason: `命名空间属于 ${project.slug}，项目标签却是 ${label}` } : { scope: 'project', projectId: project.projectId, projectName: project.name, slug: project.slug, projectKind: project.kind, archived: project.state === 'archived' };
    const entry = system.get(obj.metadata.uid!);
    if (entry) return label && label !== 'platform' ? { scope: 'unresolved', reason: `系统组件带有不一致的项目标签：${label}` } : { scope: 'system', component: entry.component };
    if (obj.metadata.labels?.['app.kubernetes.io/managed-by'] === 'crewstation') return { scope: 'unresolved', reason: '受管资源没有已登记项目或系统组件归属' };
    return undefined;
  };
  return { byUid, byKey, system, owner, ownership };
}
