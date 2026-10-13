type Outcome = 'success' | 'failed';
type Fulfilled = ((value: unknown) => unknown) | null | undefined;
type Rejected = ((error: unknown) => unknown) | null | undefined;

function measuredQuery(value: unknown, observe: (state: Outcome, microseconds: bigint) => void): unknown {
  if (!value || typeof value !== 'object' || typeof (value as { then?: unknown }).then !== 'function') return value;
  let measured = false;
  let started: number | undefined;
  const finish = (state: Outcome) => {
    if (measured) return;
    measured = true;
    // Telemetry cannot change the result of the original database operation.
    try { observe(state, BigInt(Math.max(0, Math.floor((performance.now() - started!) * 1000)))); } catch { /* Original query semantics win. */ }
  };
  const then = (resolve?: Fulfilled, reject?: Rejected) => {
    started ??= performance.now();
    return Reflect.apply(Reflect.get(value, 'then'), value, [
      (result: unknown) => { finish('success'); return typeof resolve === 'function' ? resolve(result) : result; },
      (error: unknown) => { finish('failed'); if (typeof reject === 'function') return reject(error); throw error; },
    ]) as Promise<unknown>;
  };
  // A native Promise is already executing and requires its real internal brand.
  // Keep the lazy driver objects lazy; a Proxy of a native Promise breaks
  // consumers using native Promise operations and rejection handling.
  if (Object.getPrototypeOf(value) === Promise.prototype) {
    started ??= performance.now();
    return (value as Promise<unknown>).then(
      result => { finish('success'); return result; },
      error => { finish('failed'); throw error; },
    );
  }
  const proxy: object = new Proxy(value, {
    get(target, key, receiver) {
      if (key === 'then') return then;
      if (key === 'catch') return (reject?: Rejected) => then(undefined, reject);
      if (key === 'finally') return (callback?: (() => unknown) | null) => then().finally(callback);
      const result = Reflect.get(target, key, receiver);
      // postgres.js values/raw/simple return the same lazy query. Preserve the
      // measured handle through those calls; Drizzle executes through values().
      return typeof result === 'function' ? (...args: unknown[]) => {
        const next = Reflect.apply(result, target, args);
        return next === target ? proxy : next;
      } : result;
    },
  });
  return proxy;
}

/** Count real completions, including pool wait; statement text, parameters and results are never inspected. */
export function timedSql<T extends object>(client: T, observe: (state: Outcome, microseconds: bigint) => void): T {
  return new Proxy(client, {
    apply(target, thisArg, args) {
      return measuredQuery(Reflect.apply(target as unknown as (...args: unknown[]) => unknown, thisArg, args), observe);
    },
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if ((key === 'begin' || key === 'savepoint') && typeof value === 'function') {
        return (...args: unknown[]) => Reflect.apply(value, target, args.map(arg => typeof arg === 'function' ? (child: object) => Reflect.apply(arg, undefined, [timedSql(child, observe)]) : arg));
      }
      if (key === 'reserve' && typeof value === 'function') return async (...args: unknown[]) => timedSql(await Reflect.apply(value, target, args), observe);
      if ((key === 'unsafe' || key === 'file') && typeof value === 'function') return (...args: unknown[]) => measuredQuery(Reflect.apply(value, target, args), observe);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
