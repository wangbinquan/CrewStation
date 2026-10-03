import type {RuntimeReportSection} from '@crewstation/contracts';
import {completeOrdinalKey} from '../../domain/completeOrdinal';
import type {CompleteRuntimeCohortInput,CompleteRuntimeReportRow} from '../../ports/completeRuntimeCohort';
import type {CompleteWorkingRow} from '../../ports/completeWorkingRows';
import {completeWorkingCache} from '../completeWorkingCache';
import {completeWorkingTraversal} from '../completeWorkingTraversal';
export interface CompleteReportCount {readonly section:RuntimeReportSection;readonly parent:string|null;readonly total:string}
/** Bounded buffers retain every page in original TEMP before a sealed streaming export. */
export function completeReportRows(input:Pick<CompleteRuntimeCohortInput,'rows'|'namespace'|'keyOf'|'signal'>) {
  const namespace=input.namespace+'/ready-rows',countsNamespace=input.namespace+'/row-counts';
  const counts=completeWorkingCache<CompleteReportCount>(input.rows,countsNamespace,input.signal);
  let ordinal=0n;const buffer:CompleteWorkingRow<CompleteRuntimeReportRow>[]=[];
  async function flush() {
    input.signal?.throwIfAborted();
    if(buffer.length) {await input.rows.insert(namespace,buffer);buffer.length=0;}
    await counts.flush();
  }
  return {namespace,countsNamespace,flush,
    async append(section:RuntimeReportSection,parent:string|null,key:string,document:unknown) {
      input.signal?.throwIfAborted();const identity=input.keyOf(JSON.stringify([section,parent]));
      const previous=await counts.get(identity);
      if(previous&&(previous.section!==section||previous.parent!==parent)) throw new Error('Complete report parent identity changed');
      const row:CompleteRuntimeReportRow={section,parent,key,document};
      buffer.push({key:completeOrdinalKey(ordinal++),document:row});
      await counts.put(identity,{section,parent,total:String(BigInt(previous?.total??'0')+1n)});
      if(buffer.length===500) await flush();
    },
    async finalizeCounts() {
      await flush();
      for await(const row of completeWorkingTraversal<CompleteReportCount>(input.rows,countsNamespace,input.signal)) {
        if(!/^(0|[1-9]\d*)$/.test(row.document.total)) throw new Error('Complete report row count malformed');
      }
    },
  };
}
