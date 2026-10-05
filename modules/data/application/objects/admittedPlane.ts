import { precondition } from '@crewstation/kernel';
import type { ObjectRequestRunner } from '../../ports/deletion/objectWork';
import type { ObjectBackendPlane, ObjectBytes } from '../../ports/objectStorage';

/** The GET handoff exposes the body while the original callback remains admitted until completion. */
export function admittedObjectPlane(plane: ObjectBackendPlane, requests: ObjectRequestRunner): ObjectBackendPlane {
  return {
    configure: (...args) => plane.configure(...args), probe: (...args) => plane.probe(...args), metrics: () => plane.metrics(),
    ...(plane.prepareRotation ? { prepareRotation: (...args: Parameters<NonNullable<ObjectBackendPlane['prepareRotation']>>) => plane.prepareRotation!(...args) } : {}),
    ...(plane.inspectWrite ? { inspectWrite: (location: Parameters<NonNullable<ObjectBytes['inspectWrite']>>[0], signal: AbortSignal) => requests.run(location,'inspect',() => plane.inspectWrite!(location,signal)) } : {}),
    put: (location,input) => requests.run(location,'put',async origin => {
      if (origin.size !== input.size) throw precondition('object PUT size differs from the original attempt');
      return plane.put(location,input);
    }),
    verify: (location,signal,expected) => requests.run(location,'verify',() => plane.verify(location,signal,expected)),
    remove: (location,signal) => requests.run(location,'remove',() => plane.remove(location,signal)),
    get: (location,input) => admittedGet(plane,requests,location,input),
  };
}
async function admittedGet(plane: ObjectBackendPlane, requests: ObjectRequestRunner, location: Parameters<ObjectBytes['get']>[0], input: Parameters<ObjectBytes['get']>[1]) {
  const ready = Promise.withResolvers<Awaited<ReturnType<ObjectBytes['get']>>>();
  const completed = requests.run(location,'get',async () => {
    const result = trackedObjectDownload(await plane.get(location,input));
    ready.resolve(result);
    return result.completed;
  });
  void completed.catch(ready.reject);
  const result = await ready.promise;
  return { ...result, completed };
}

/** Buffered upstream completion cannot end a response that still owns the original body. */
export function trackedObjectDownload<T extends Awaited<ReturnType<ObjectBytes['get']>>>(result: T) {
  const reader = result.body.getReader(), ended = Promise.withResolvers<void>();
  let terminal = false, bodyFailed = false, bodyError: unknown, controller!: ReadableStreamDefaultController<Uint8Array>;
  const finish = () => { reader.releaseLock(); ended.resolve(); };
  const body = new ReadableStream<Uint8Array>({
    start: value => { controller = value; },
    pull: async () => {
      try {
        const next = await reader.read();
        if (terminal) return;
        if (next.done) { terminal = true; controller.close(); finish(); }
        else controller.enqueue(next.value);
      } catch (error) {
        if (terminal) return;
        terminal = true; bodyFailed = true; bodyError = error;
        try { controller.error(error); await reader.cancel(error).catch(() => undefined); }
        finally { finish(); }
      }
    },
    cancel: async reason => {
      if (terminal) return;
      terminal = true;
      try { await reader.cancel(reason); } finally { finish(); }
    },
  }, { highWaterMark: 0 });
  const upstream = result.completed.then(value => ({ ok: true as const,value }),async error => {
    if (!terminal) {
      terminal = true;
      try { controller.error(error); await reader.cancel(error).catch(() => undefined); }
      finally { finish(); }
    }
    return { ok: false as const,error: error as unknown };
  });
  const completed = Promise.all([ended.promise,upstream]).then(([,outcome]) => {
    if (bodyFailed) throw bodyError;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  });
  return { ...result,body,completed };
}
