/** Original in-process measurements. Missing providers produce unavailable, never a guessed healthy zero. */
export interface RuntimeSignal {kind:string;unit:string;value:string;labels?:Readonly<Record<string,string>>}
type Source=()=>Promise<readonly RuntimeSignal[]>|readonly RuntimeSignal[];
const providers=new Map<string,{read:Source;pending?:Promise<readonly RuntimeSignal[]>}>();
const values=new Map<string,RuntimeSignal>();
export function registerRuntimeSignals(name:string,read:Source){const entry={read};providers.set(name,entry);return()=>{if(providers.get(name)===entry)providers.delete(name);};}
export function setRuntimeSignal(kind:string,unit:string,value:string,labels?:Readonly<Record<string,string>>){values.set(JSON.stringify([kind,labels]),{kind,unit,value,...(labels?{labels}:{})});}
export function incrementRuntimeSignal(kind:string,unit:string,by=1n,labels?:Readonly<Record<string,string>>){const key=JSON.stringify([kind,labels]),previous=values.get(key);setRuntimeSignal(kind,unit,String(BigInt(previous?.value??'0')+by),labels);}
const escape=(s:string)=>s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('\n','\\n');
export async function renderRuntimeSignals(component:string){
 const output:string[]=[];const append=(source:string,value:RuntimeSignal)=>{const numeric=Number(value.value);if(!Number.isFinite(numeric)||numeric<0)throw new Error('Application metric invalid');const labels={component,source,kind:value.kind,unit:value.unit,...value.labels};output.push(`cs_application_metric{${Object.entries(labels).map(([k,v])=>`${k}="${escape(v)}"`).join(',')}} ${value.value}`);};
 for(const value of values.values())append('process',value);
 await Promise.all([...providers].map(async([name,entry])=>{let timer:ReturnType<typeof setTimeout>|undefined;try{entry.pending??=Promise.resolve().then(entry.read).finally(()=>{entry.pending=undefined;});const sampled=await Promise.race([entry.pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Metric source timeout')),2000);})]);for(const value of sampled)append(name,value);output.push(`cs_application_source_available{component="${escape(component)}",source="${escape(name)}"} 1`);}catch{output.push(`cs_application_source_available{component="${escape(component)}",source="${escape(name)}"} 0`);}finally{clearTimeout(timer);}}));
 return output.join('\n')+'\n';
}
