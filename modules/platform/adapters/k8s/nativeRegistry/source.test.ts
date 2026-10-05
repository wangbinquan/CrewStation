import {describe,test,expect} from 'bun:test';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFakeK8sClient,Resources} from '@crewstation/k8s';
import {createFilesystemMetricsHandler} from '@crewstation/filesystem-metrics';
import {nativeRegistrySource} from './source';
const slice={apiVersion:'discovery.k8s.io/v1',kind:'EndpointSlice',plural:'endpointslices',namespaced:true};
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'cs-native-registry-source-')),base=join(root,'volume/docker/registry/v2'),k8s=createFakeK8sClient(),token='registry-source-token'.padEnd(40,'0');
  const file=async(path:string,body:string)=>{const full=join(base,path);await mkdir(full.slice(0,full.lastIndexOf('/')),{recursive:true});await writeFile(full,body);};
  const blob=async(body:string)=>{const hex=createHash('sha256').update(body).digest('hex');await file(`blobs/sha256/${hex.slice(0,2)}/${hex}/data`,body);return 'sha256:'+hex;};
  const config=await blob('{}'),layer=await blob('original layer'),image=await blob(JSON.stringify({schemaVersion:2,config:{digest:config},layers:[{digest:layer}]}));
  await file(`repositories/apps/original/_manifests/revisions/sha256/${image.slice(7)}/link`,image);
  await k8s.apply({apiVersion:'v1',kind:'Namespace',metadata:{name:'system',uid:'system-original'}});
  await k8s.apply({apiVersion:'v1',kind:'Service',metadata:{name:'registry',namespace:'system',uid:'service-original'},spec:{selector:{app:'registry'},ports:[{port:5000,targetPort:5000}]}});
  await k8s.apply({apiVersion:'discovery.k8s.io/v1',kind:'EndpointSlice',metadata:{name:'registry-endpoints',namespace:'system',uid:'slice-original',labels:{'kubernetes.io/service-name':'registry'},ownerReferences:[{apiVersion:'v1',kind:'Service',name:'registry',uid:'service-original'}]},ports:[{port:5000}],endpoints:[{addresses:['10.0.0.2'],conditions:{ready:true},targetRef:{kind:'Pod',namespace:'system',name:'registry-0',uid:'registry-original'}}]});
  await k8s.apply({apiVersion:'v1',kind:'Node',metadata:{name:'node',uid:'node-original'},status:{conditions:[{type:'Ready',status:'True'}],nodeInfo:{kubeletVersion:'v1.34.0'}}});
  await k8s.apply({apiVersion:'coordination.k8s.io/v1',kind:'Lease',metadata:{name:'node',namespace:'kube-node-lease',ownerReferences:[{apiVersion:'v1',kind:'Node',name:'node',uid:'node-original'}]},spec:{holderIdentity:'node',renewTime:new Date().toISOString()}});
  await k8s.apply({apiVersion:'v1',kind:'Pod',metadata:{name:'registry-0',namespace:'system',uid:'registry-original',labels:{app:'registry'}},spec:{nodeName:'node',volumes:[{name:'data',persistentVolumeClaim:{claimName:'registry-data'}}],containers:[{name:'registry',env:[{name:'REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY',value:'/var/lib/registry'}],volumeMounts:[{name:'data',mountPath:'/var/lib/registry'}]}]},status:{podIP:'10.0.0.2',conditions:[{type:'Ready',status:'True'}],containerStatuses:[{name:'registry',containerID:'containerd://'+'c'.repeat(64),imageID:'docker.io/library/registry@sha256:'+'d'.repeat(64),ready:true,state:{running:{}}}]} });
  await k8s.apply({apiVersion:'v1',kind:'PersistentVolumeClaim',metadata:{name:'registry-data',namespace:'system',uid:'pvc-original'},spec:{volumeName:'registry-pv'}});
  await k8s.apply({apiVersion:'v1',kind:'PersistentVolume',metadata:{name:'registry-pv',uid:'pv-original',annotations:{'pv.kubernetes.io/provisioned-by':'rancher.io/local-path','local.path.provisioner/selected-node':'node'}},spec:{claimRef:{uid:'pvc-original',name:'registry-data',namespace:'system'},hostPath:{path:join(root,'volume')}}});
  await k8s.apply({apiVersion:'v1',kind:'Pod',metadata:{name:'probe',namespace:'system',uid:'probe-original',labels:{app:'cs-storage-probe'}},spec:{nodeName:'node',volumes:[{name:'source',hostPath:{path:root,type:'Directory'}}],containers:[{name:'probe',volumeMounts:[{name:'source',mountPath:'/volumes',readOnly:true}]}]},status:{podIP:'10.0.0.3',conditions:[{type:'Ready',status:'True'}]} });
  const handler=createFilesystemMetricsHandler({token,roots:{local:root}}),calls:string[]=[];
  const fetcher=(async(url,init)=>{calls.push(String(url));return handler(new Request(String(url),init));}) as typeof fetch;
  const options={namespace:'system',service:'registry',port:5000,container:'registry',imageDigest:'sha256:'+'d'.repeat(64),probeRoot:root,probePort:8095,probeToken:token};
  const query={exact:['apps/original'],prefixes:[],retainedDigests:[],retainedManifests:[]};
  return {root,base,k8s,options,query,fetcher,calls,adapter:nativeRegistrySource(k8s,options,fetcher),drop:()=>rm(root,{recursive:true,force:true})};
}
describe('actual registry source bridge; real filesystem and controlled K8s',()=>{
  test('a caller changing repository scope while the original source is being read cannot change that capture',async()=>{
    const f=await fixture();try{
      const get=f.k8s.get.bind(f.k8s);let release!:()=>void,entered!:()=>void;
      const reading=new Promise<void>(resolve=>{entered=resolve;}),pause=new Promise<void>(resolve=>{release=resolve;});
      let first=true;
      const client={...f.k8s,get:(async(...args:Parameters<typeof get>)=>{
        if(first){first=false;entered();await pause;}return get(...args);
      }) as typeof get};
      const requests:unknown[]=[];
      const fetcher=(async(url,init)=>{requests.push(JSON.parse(String(init?.body)));return f.fetcher(url,init);}) as typeof fetch;
      const pending=nativeRegistrySource(client,f.options,fetcher).capture(f.query);
      await reading;f.query.exact[0]='apps/foreign';release();
      const original=await pending;
      expect(requests[0]).toMatchObject({exact:['apps/original']});
      expect(original.inventory.repositories).toEqual(['apps/original']);
      expect(original.inventory.blobs).toHaveLength(3);
    }finally{await f.drop();}
  });
  test('binds the original instance and original volume to the actual private probe without deletion',async()=>{
    const f=await fixture();try{
      const original=await f.adapter.capture(f.query);expect(original.origin).toMatchObject({namespaceUid:'system-original',serviceUid:'service-original',podUid:'registry-original',nodeUid:'node-original',pvcUid:'pvc-original',pvUid:'pv-original',probeUid:'probe-original'});
      expect(original.inventory.blobs).toHaveLength(3);expect(f.calls).toEqual(['http://10.0.0.3:8095/registry/inventory']);
      expect((await f.adapter.verify(f.query,original)).identity).toBe(original.identity);expect(f.k8s.deleted).toHaveLength(0);
    }finally{await f.drop();}
  });
  for(const mode of ['image','root','command','subpath','overlap','csi','claim','stale node','missing probe','extra instance','foreign endpoint'])test(`${mode} cannot be treated as the original storage`,async()=>{
    const f=await fixture();try{
      if(mode==='image')f.options.imageDigest='sha256:'+'e'.repeat(64);
      if(['root','command','subpath','overlap'].includes(mode)){
        const pod=(await f.k8s.get(Resources.Pod!,'registry-0','system'))!,spec=pod['spec'] as {containers:Array<{command?:string[];env:Array<{name:string;value:string}>;volumeMounts:Array<{name:string;mountPath:string;subPath?:string}>}>};
        if(mode==='root')spec.containers[0]!.env[0]!.value='/unknown';if(mode==='command')spec.containers[0]!.command=['custom'];
        if(mode==='subpath')spec.containers[0]!.volumeMounts[0]!.subPath='partial';if(mode==='overlap')spec.containers[0]!.volumeMounts.push({name:'another',mountPath:'/var/lib/registry/hidden'});await f.k8s.apply(pod);
      }
      if(mode==='csi')await f.k8s.mergePatch(Resources.PersistentVolume!,'registry-pv',undefined,{spec:{csi:{driver:'unknown'}}});
      if(mode==='claim')await f.k8s.mergePatch(Resources.PersistentVolume!,'registry-pv',undefined,{spec:{claimRef:{uid:'other'}}});
      if(mode==='stale node')await f.k8s.mergePatch(Resources.Lease!,'node','kube-node-lease',{spec:{renewTime:'2000-01-01T00:00:00Z'}});
      if(mode==='missing probe')await f.k8s.delete(Resources.Pod!,'probe','system');
      if(mode==='extra instance'){const pod=(await f.k8s.get(Resources.Pod!,'registry-0','system'))!;pod.metadata.name='registry-1';pod.metadata.uid='other-registry';await f.k8s.apply(pod);}
      if(mode==='foreign endpoint')await f.k8s.mergePatch(slice,'registry-endpoints','system',{metadata:{ownerReferences:[{kind:'Service',uid:'foreign'}]}});
      await expect(nativeRegistrySource(f.k8s,f.options,f.fetcher).capture(f.query)).rejects.toThrow();expect(f.calls).toHaveLength(0);
    }finally{await f.drop();}
  });
  test('same names with replaced Pod, PVC, PV, namespace or native directory cannot verify the original',async()=>{
    for(const mode of ['pod','pvc','pv','namespace','directory']){const f=await fixture();try{
      const original=await f.adapter.capture(f.query);
      if(mode==='pod'){
        await f.k8s.mergePatch(Resources.Pod!,'registry-0','system',{metadata:{uid:'replacement-pod'}});
        await f.k8s.mergePatch(slice,'registry-endpoints','system',{endpoints:[{addresses:['10.0.0.2'],conditions:{ready:true},targetRef:{kind:'Pod',namespace:'system',name:'registry-0',uid:'replacement-pod'}}]});
      }
      if(mode==='pvc'){await f.k8s.mergePatch(Resources.PersistentVolumeClaim!,'registry-data','system',{metadata:{uid:'replacement-pvc'}});await f.k8s.mergePatch(Resources.PersistentVolume!,'registry-pv',undefined,{spec:{claimRef:{uid:'replacement-pvc'}}});}
      if(mode==='pv')await f.k8s.mergePatch(Resources.PersistentVolume!,'registry-pv',undefined,{metadata:{uid:'replacement-pv'}});
      if(mode==='namespace')await f.k8s.mergePatch(Resources.Namespace!,'system',undefined,{metadata:{uid:'replacement-namespace'}});
      if(mode==='directory'){await rename(join(f.root,'volume'),join(f.root,'old'));await mkdir(join(f.base,'repositories'),{recursive:true});}
      await expect(f.adapter.verify(f.query,original)).rejects.toThrow('已替换');expect(f.k8s.deleted).toHaveLength(0);
    }finally{await f.drop();}}
  });
  test('lost source, stale receipt, mid-observation replacement and repeated pages do not produce a completed origin',async()=>{
    for(const mode of ['offline','stale','probe replaced','server replaced','page repeat']){const f=await fixture();try{
      const fetcher=(async(url,init)=>{
        if(mode==='offline')return new Response(null,{status:503});const response=await f.fetcher(url,init),body=await response.json();
        if(mode==='stale')body.observedAt='2000-01-01T00:00:00Z';
        if(mode==='probe replaced')await f.k8s.mergePatch(Resources.Pod!,'probe','system',{metadata:{uid:'replacement'}});
        if(mode==='server replaced')await f.k8s.mergePatch(Resources.Pod!,'registry-0','system',{status:{containerStatuses:[{name:'registry',containerID:'containerd://'+'e'.repeat(64),imageID:'docker.io/library/registry@'+f.options.imageDigest,ready:true,state:{running:{}}}]}});
        return Response.json(body);
      })as typeof fetch;
      const list=f.k8s.listPage.bind(f.k8s),client=mode==='page repeat'?{...f.k8s,listPage:(async(...args:Parameters<typeof list>)=>({...await list(...args),continue:'repeat'}))as typeof list}:f.k8s;
      await expect(nativeRegistrySource(client,f.options,fetcher).capture(f.query)).rejects.toThrow();
    }finally{await f.drop();}}
  });
});
