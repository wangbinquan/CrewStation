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
