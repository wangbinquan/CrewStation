import type { CompleteWorkingRows,CompleteWorkingRow } from '../ports/completeWorkingRows';

/** A bounded cache only avoids round trips; evicted derived state is retained in original TEMP. */
export function completeWorkingCache<T>(rows:CompleteWorkingRows,namespace:string,signal?:AbortSignal) {
  const cache=new Map<string,T|undefined>(),dirty=new Map<string,T>();
  async function flush() {
    signal?.throwIfAborted();if(!dirty.size) return;
    const batch:CompleteWorkingRow<T>[]=[...dirty].map(([key,document])=>({key,document}));
    await rows.upsert(namespace,batch);dirty.clear();
  }
  async function remember(key:string,document:T|undefined) {
    cache.delete(key);cache.set(key,document);
    if (cache.size>4096) {
      const oldest=cache.keys().next().value!;
      if(dirty.has(oldest)) await flush();
      cache.delete(oldest);
    }
  }
  return {
    flush,
    async prefetch(keys:readonly string[]) {
      signal?.throwIfAborted();const pending=[...new Set(keys)].filter(key=>!cache.has(key)&&!dirty.has(key));
      for(let offset=0;offset<pending.length;offset+=500){signal?.throwIfAborted();const part=pending.slice(offset,offset+500),found=new Map((await rows.getMany<T>(namespace,part)).map(row=>[row.key,row.document]));for(const key of part)await remember(key,found.get(key));}
    },
    async get(key:string) {
      signal?.throwIfAborted();const found=cache.has(key)?cache.get(key):dirty.has(key)?dirty.get(key):await rows.get<T>(namespace,key);
      await remember(key,found);return found;
    },
    async put(key:string,document:T) {
      signal?.throwIfAborted();dirty.set(key,document);
      if(dirty.size===500) await flush();await remember(key,document);
    },
  };
}
