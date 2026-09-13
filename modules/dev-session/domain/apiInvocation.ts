import type { ApiInvocationRequest, ApiOperationDto, RunnerApiInvocation } from '@crewstation/contracts';
import { RunnerApiInvocationSchema } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';

/** 方法和路径来自当前目录，用户只填参数。缺失／多填参数一律显式报错，不静默忽略。 */
export function resolveApiInvocation(operation: ApiOperationDto, input: ApiInvocationRequest): RunnerApiInvocation {
  const names = [...operation.path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]!);
  const missing = names.filter((name) => !Object.hasOwn(input.pathParameters, name) || input.pathParameters[name] === '');
  const extra = Object.keys(input.pathParameters).filter((name) => !names.includes(name));
  if (missing.length || extra.length) throw new PlatformError('validation', '路径参数与当前操作不一致', { field: 'pathParameters', missing, extra });
  let path: string;
  try { path = operation.path.replace(/\{([^{}]+)\}/g, (_match, name: string) => encodeURIComponent(input.pathParameters[name]!)); }
  catch { throw new PlatformError('validation', '路径参数包含无法编码的字符', { field: 'pathParameters' }); }
  const parsed = RunnerApiInvocationSchema.safeParse({ proxy: operation.proxy, method: operation.method, path, query: input.query, headers: input.headers, body: input.body });
  if (!parsed.success) throw new PlatformError('validation', '试调参数无法用于当前操作', { issues: parsed.error.issues });
  return parsed.data;
}
