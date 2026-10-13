// RFC-034: exporters are scraped per Pod and the installed component names remain exact.
import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import {parseAllDocuments} from 'yaml';
import {resolve} from 'node:path';
const root=resolve(import.meta.dir,'../k8s');
test('runtime and physical gateway metrics use exact existing selectors and no load-balanced counter target',()=>{
 const text=readFileSync(resolve(root,'platform/38-cluster-metrics.yaml'),'utf8'),documents=parseAllDocuments(text);for(const document of documents)expect(document.errors).toHaveLength(0);
 const values=documents.map(document=>document.toJSON()),config=values.find(v=>v.kind==='ConfigMap'&&v.metadata.name==='prometheus-config');
 const jobs=parseAllDocuments(config.data['prometheus.yml'])[0]!.toJSON().scrape_configs;
 expect(jobs.find((j:{job_name:string})=>j.job_name==='crewstation-runtime').static_configs).toBeUndefined();
 for(const [file,name] of [['30-cs-api.yaml','cs-api'],['31-cs-auth.yaml','cs-auth'],['32-cs-controller.yaml','cs-controller'],['33-cs-session.yaml','cs-session'],['34-cs-events.yaml','cs-events'],['36-mcp-capabilities.yaml','mcp-capabilities'],['37-mcp-operations.yaml','mcp-operations']]) {
  const workload=parseAllDocuments(readFileSync(resolve(root,'platform',file!),'utf8')).map(v=>v.toJSON()).find(v=>v.kind==='Deployment');
  const service=values.find(v=>v.kind==='Service'&&v.metadata.name===name+'-runtime-metrics');expect(service.spec.clusterIP).toBe('None');expect(service.spec.selector).toEqual(workload.spec.selector.matchLabels);
 }
 const gateway=readFileSync(resolve(root,'system/32-traefik.yaml'),'utf8');expect(gateway).toContain('--metrics.prometheus.addServicesLabels=true');expect(gateway).toContain('--metrics.prometheus.addRoutersLabels=false');
});


type Labels = Record<string, string>;
type Selector = { matchLabels?: Labels; matchExpressions?: { key: string; operator: string; values?: string[] }[] };
type Peer = { namespace: string; labels: Labels; namespaceLabels: Labels };
type Policy = { kind: string; metadata: { namespace: string }; spec: { podSelector: Selector; policyTypes: string[]; ingress?: { from?: { podSelector?: Selector; namespaceSelector?: Selector }[]; ports?: { port: number | string; protocol?: string }[] }[] } };
type Workload = { kind: string; spec: { template: { metadata: { labels: Labels }; spec: { containers: { ports: { name: string; containerPort: number }[] }[] } } } };
function selected(selector: Selector | undefined, labels: Labels): boolean {
 if (!selector) return true;
 if (!Object.entries(selector.matchLabels ?? {}).every(([key,value])=>labels[key]===value)) return false;
 return (selector.matchExpressions ?? []).every(expression=>{
  if (expression.operator==='In') return expression.values!.includes(labels[expression.key]!);
  if (expression.operator==='NotIn') return !expression.values!.includes(labels[expression.key]!);
  if (expression.operator==='Exists') return expression.key in labels;
  if (expression.operator==='DoesNotExist') return !(expression.key in labels);
  throw new Error('Unsupported manifest selector: '+expression.operator);
 });
}
function ingressAllowed(policies: Policy[], caller: Peer, target: Peer, port: number): boolean {
 const isolated=policies.filter(policy=>policy.metadata.namespace===target.namespace&&policy.spec.policyTypes.includes('Ingress')&&selected(policy.spec.podSelector,target.labels));
 // Applicable Kubernetes ingress policies are additive; absence of a selecting
 // ingress policy preserves the original non-isolated state, not new authorization.
 return isolated.length===0||isolated.some(policy=>(policy.spec.ingress??[]).some(rule=>
  (!rule.ports||rule.ports.some(item=>(item.protocol??'TCP')==='TCP'&&item.port===port))&&
  (!rule.from||rule.from.some(from=>(from.namespaceSelector?selected(from.namespaceSelector,caller.namespaceLabels):caller.namespace===policy.metadata.namespace)&&selected(from.podSelector,caller.labels)))));
}
test('metrics ingress preserves original gateway, login and platform calls while its dedicated endpoint remains restricted',()=>{
 // CI 38405974297: new exporter selection isolated the previously reachable
 // auth/gateway Pods and timed out /auth/status before any administrator existed.
 const values=parseAllDocuments(readFileSync(resolve(root,'platform/38-cluster-metrics.yaml'),'utf8')).map(document=>document.toJSON());
 const policies=values.filter(value=>value.kind==='NetworkPolicy') as Policy[];
 const namespace='crewstation-system',namespaceLabels={'kubernetes.io/metadata.name':namespace};
 const peer=(labels: Labels): Peer=>({namespace,namespaceLabels,labels});
 const gateway=parseAllDocuments(readFileSync(resolve(root,'system/32-traefik.yaml'),'utf8')).map(document=>document.toJSON()).find(value=>value.kind==='Deployment') as Workload;
 const gatewayPeer=peer(gateway.spec.template.metadata.labels),prometheus=peer({'app.kubernetes.io/name':'prometheus'});
 const external: Peer={namespace:'external',namespaceLabels:{'kubernetes.io/metadata.name':'external'},labels:{}};
 const unrelated=peer({'app.kubernetes.io/name':'unrelated'});
 for (const port of gateway.spec.template.spec.containers[0]!.ports) {
  if (port.name==='traefik') {
   expect(ingressAllowed(policies,prometheus,gatewayPeer,port.containerPort)).toBe(true);
   expect(ingressAllowed(policies,external,gatewayPeer,port.containerPort)).toBe(false);
   expect(ingressAllowed(policies,unrelated,gatewayPeer,port.containerPort)).toBe(false);
  } else expect(ingressAllowed(policies,external,gatewayPeer,port.containerPort)).toBe(true);
 }
 for (const file of ['30-cs-api.yaml','31-cs-auth.yaml','32-cs-controller.yaml','33-cs-session.yaml','34-cs-events.yaml','36-mcp-capabilities.yaml','37-mcp-operations.yaml']) {
  const workload=parseAllDocuments(readFileSync(resolve(root,'platform',file),'utf8')).map(document=>document.toJSON()).find(value=>value.kind==='Deployment') as Workload;
  const target=peer(workload.spec.template.metadata.labels),port=workload.spec.template.spec.containers[0]!.ports[0]!.containerPort;
  expect(ingressAllowed(policies,gatewayPeer,target,port)).toBe(true);
  expect(ingressAllowed(policies,prometheus,target,port)).toBe(true);
  expect(ingressAllowed(policies,external,target,port)).toBe(true);
 }
});
