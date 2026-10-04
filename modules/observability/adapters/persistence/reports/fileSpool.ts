import {mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {jsonHash} from '@crewstation/kernel';
import {ResourceIdSchema,RuntimeReportHeaderSchema,RuntimeFactReportHeaderSchema,RuntimeCompleteSummarySchema,RuntimeCompleteFactSummarySchema} from '@crewstation/contracts';
import {assertCompleteRuntimeFactItem} from '../../../domain/completeReportFacts';
import {completeReportInitialDigest,completeReportTransferPage,assertCompleteReportTransferPage,assertCompleteReportManifest} from '../../../domain/completeReportEnvelope';
import type {CompleteReportSpool,CompleteReportManifest,CompleteReportTransferItem,CompleteReportTransferPage} from '../../../ports/completeRuntimeReportCache';
/** Original configured operations root; files only transport sealed derived rows. */
export function completeRuntimeFileSpool(dataRoot:string):CompleteReportSpool {
 if(!isAbsolute(dataRoot))throw new Error('Runtime report data root must be an absolute configured path');
 const workRoot=resolve(dataRoot,'runtime-reports');
 function originalFolders(){
  if(!existsSync(workRoot))return [];
  if(!lstatSync(workRoot).isDirectory()||lstatSync(workRoot).isSymbolicLink())throw new Error('Original report work root changed');
  return readdirSync(workRoot).map(id=>{ResourceIdSchema.parse(id);const report=resolve(workRoot,id);
   if(!lstatSync(report).isDirectory()||lstatSync(report).isSymbolicLink())throw new Error('Unknown report work entry');
   for(const owner of readdirSync(report)){if(!/^[a-f0-9]{64}$/.test(owner))throw new Error('Unknown report work owner');const folder=resolve(report,owner);
    if(!lstatSync(folder).isDirectory()||lstatSync(folder).isSymbolicLink())throw new Error('Unknown report owner entry');
    for(const name of readdirSync(folder)){const file=resolve(folder,name);if(name!=='sealed.json'&&!/^(0|[1-9]\d*)\.json$/.test(name)||!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink())throw new Error('Unknown report page entry');}
   }return report;
  });
 }
 const directory=(id:string,owner:string)=>{if(!owner)throw new Error('Original report build owner missing');return resolve(dataRoot,'runtime-reports',ResourceIdSchema.parse(id),jsonHash(owner));};
 return {
  async seal(identity,items,signal) {
   const facts=identity.header.coverage==='complete-facts';
   (facts?RuntimeFactReportHeaderSchema:RuntimeReportHeaderSchema).parse(identity.header);(facts?RuntimeCompleteFactSummarySchema:RuntimeCompleteSummarySchema).parse(identity.summary);
   if(identity.header.reportId!==identity.reportId||identity.header.generation!==identity.generation||identity.header.sourceRevision!==identity.sourceRevision||!facts&&identity.summary.metrics.state==='not-ready')throw new Error('Incomplete runtime report cannot be sealed');
   const folder=directory(identity.reportId,identity.buildOwner);mkdirSync(folder,{recursive:true});
   let pages=0n,rows=0n,counts=0n,receipts=0n,digest=completeReportInitialDigest,buffer:CompleteReportTransferItem[]=[];
   const flush=()=>{if(!buffer.length)return;const page=completeReportTransferPage(identity.reportId,String(pages),digest,buffer);writeFileSync(resolve(folder,String(pages)+'.json'),JSON.stringify(page),{flag:'wx'});digest=page.digest;pages++;buffer=[];};
   for await(const item of items){signal?.throwIfAborted();if(facts)assertCompleteRuntimeFactItem(item);buffer.push(item);if(item.kind==='row')rows++;else if(item.kind==='count')counts++;else receipts++;if(buffer.length===500)flush();}
   signal?.throwIfAborted();flush();
   const manifest:CompleteReportManifest={...identity,pages:String(pages),rows:String(rows),counts:String(counts),receipts:String(receipts),digest};
   writeFileSync(resolve(folder,'sealed.json'),JSON.stringify(manifest),{flag:'wx'});return manifest;
  },
  async *pages(manifest,signal) {
   const folder=directory(manifest.reportId,manifest.buildOwner),sealed=JSON.parse(readFileSync(resolve(folder,'sealed.json'),'utf8')) as CompleteReportManifest;
   if(JSON.stringify(sealed)!==JSON.stringify(manifest))throw new Error('Original sealed report manifest changed');
   const actual={pages:0n,rows:0n,counts:0n,receipts:0n,digest:completeReportInitialDigest};
   while(actual.pages<BigInt(manifest.pages)) {
    signal?.throwIfAborted();const page=JSON.parse(readFileSync(resolve(folder,String(actual.pages)+'.json'),'utf8')) as CompleteReportTransferPage;
    assertCompleteReportTransferPage(page,manifest.reportId,String(actual.pages),actual.digest);
    for(const item of page.items){if(item.kind==='row')actual.rows++;else if(item.kind==='count')actual.counts++;else if(item.kind==='receipt')actual.receipts++;else throw new Error('Unknown sealed report row kind');}
    actual.digest=page.digest;actual.pages++;yield page;
   }
   assertCompleteReportManifest(actual,manifest);
  },
  async remove(id,owner){rmSync(directory(id,owner),{recursive:true,force:true});},
  async clear(){for(const folder of originalFolders())rmSync(folder,{recursive:true});},
  async empty(){return originalFolders().length===0;},
 };
}
