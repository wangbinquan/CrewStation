import type { ApiOperationDto } from '@crewstation/contracts';
import { swaggerApiInvocation } from '../../hooks/swaggerApiInvocation';
import type { SwaggerBuiltRequest, SwaggerInvocationRequest } from '../../hooks/swaggerApiInvocation';
import type { ApiInvocationController } from '../../hooks/useApiInvocation';
import type { Translate } from '../../../../shared/lib/useT';
import { errorMessage } from '../../../../shared/api/useApi';

export interface SwaggerInvocationContext {
  controller: ApiInvocationController;
  operations: readonly ApiOperationDto[];
  canDevelop: boolean;
  documentReady: boolean;
}
interface SwaggerSystem {
  getSystem: () => { fn: { buildRequest: (request: SwaggerInvocationRequest) => SwaggerBuiltRequest } };
  React: { createElement: (component: unknown, props: object | null, ...children: unknown[]) => unknown };
}
interface OperationProps { operation: { get: (key: string) => unknown }; onTryoutClick: () => void; onResetClick?: (...args: unknown[]) => void }
interface ResponseProps { response: { get: (key: string) => unknown } }

export const swaggerDraftSource = (proxy: string, path: string, method: string): string => `swagger:${proxy}:${JSON.stringify([path, method.toLowerCase()])}`;

/** 固定版本 Swagger 的执行扩展点。buildRequest 只序列化参数，所有调用都走开发会话。 */
export function createSwaggerInvocationPlugin(proxy: string, read: () => SwaggerInvocationContext, translate: Translate) {
  const activated = new Set<string>();
  return (system: SwaggerSystem) => ({
    fn: { execute: async (request: SwaggerInvocationRequest) => {
      const context = read();
      try {
        if (!context.canDevelop || !context.documentReady) throw new Error('catalog.invoke.operationUnavailable');
        const built = system.getSystem().fn.buildRequest(request);
        const input = swaggerApiInvocation(proxy, request, built, context.operations, context.controller.taskId);
        const response = await context.controller.send(swaggerDraftSource(proxy, request.pathName!, request.method!), input);
        const { status, headers, body } = response.result;
        return { status, statusText: '', headers, url: built.url, text: body, data: body, csInvocationTaskId: response.taskId, csInvocationDurationMs: response.result.durationMs, csBodyTruncated: response.result.bodyTruncated, csHeadersTruncated: response.result.headersTruncated };
      } catch (failure) { context.controller.reportError(failure); throw new Error(translate(errorMessage(failure))); }
    } },
    wrapComponents: { operation: (Original: unknown) => function TrialOperation(props: OperationProps) {
      const path = props.operation.get('path'), method = props.operation.get('method');
      const source = typeof path === 'string' && typeof method === 'string' ? swaggerDraftSource(proxy, path, method) : undefined;
      const start = () => {
        const context = read();
        if (!context.canDevelop || !context.documentReady) { context.controller.reportError(new Error('catalog.invoke.operationUnavailable')); return; }
        if (!source || !context.controller.begin()) return;
        activated.add(source); props.onTryoutClick();
      };
      // 参数有防抖，不能等 Redux 更新才记草稿；否则响应先返回会清掉新输入的离开保护。
      const changed = () => { if (source && activated.has(source)) read().controller.markDirty(source); };
      // Bundle 内置 React 18，工作台为 React 19；扩展必须使用 Swagger 自己注入的 React。
      return system.React.createElement('div', { onInputCapture: changed, onChangeCapture: changed }, system.React.createElement(Original, { ...props, onTryoutClick: start, onResetClick: (...args: unknown[]) => { changed(); props.onResetClick?.(...args); } }));
    }, liveResponse: (Original: unknown) => function TrialResponse(props: ResponseProps) {
      const taskId = props.response.get('csInvocationTaskId'), duration = props.response.get('csInvocationDurationMs');
      const parts = [props.response.get('csBodyTruncated') === true ? translate('catalog.invoke.responseBody') : '', props.response.get('csHeadersTruncated') === true ? translate('catalog.invoke.responseHeaders') : ''].filter(Boolean).join(' / ');
      return system.React.createElement('div', null,
        typeof taskId === 'string' ? system.React.createElement('p', { role: 'status' }, `${translate('catalog.invoke.resultTask')} ${taskId} · ${translate('catalog.invoke.duration', { ms: typeof duration === 'number' ? duration : '?' })}`) : null,
        parts ? system.React.createElement('p', { role: 'status' }, translate('catalog.invoke.truncated', { parts })) : null,
        system.React.createElement(Original, props));
    } },
  });
}
