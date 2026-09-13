import { expect, test } from 'bun:test';
import type { ApiOperationDto } from '@crewstation/contracts';
import { emptyApiInvocationDraft, validateApiInvocationDraft } from '../features/catalog/hooks/apiInvocationDraft';
import { swaggerApiInvocation } from '../features/catalog/hooks/swaggerApiInvocation';

const operation: ApiOperationDto = { key: 'crm:POST:/items/{id}', proxy: 'crm', path: '/items/{id}', method: 'POST', openPolicy: 'default', granted: true };
const taskId = 'tsk_0123456789abcdef0123456789abcdef';

test('试调草稿同时返回所有字段错误，保留原输入且不能发送超大 UTF-8 请求体', () => {
  const draft = { ...emptyApiInvocationDraft(operation), query: 'not-json', headers: '{"x-test":"a\\nb"}', includeBody: true, body: '中'.repeat(22_000) };
  expect(validateApiInvocationDraft(operation, taskId, draft)).toEqual({ errors: { 'path:id': 'catalog.invoke.pathInvalid', query: 'catalog.invoke.queryInvalid', headers: 'catalog.invoke.headersInvalid', body: 'catalog.invoke.bodyInvalid' } });
  expect(draft.query).toBe('not-json'); expect(draft.body.length).toBe(22_000);
});

test('空请求体与不发送请求体分别表达；路径按值录入，查询数组保留重复值', () => {
  const draft = { ...emptyApiInvocationDraft(operation), pathParameters: { id: 'a / b' }, query: '{"tag":["one","two"]}' };
  const checked = validateApiInvocationDraft(operation, taskId, draft);
  expect(checked.errors).toEqual({});
  expect(checked.input).toMatchObject({ expectedTaskId: taskId, pathParameters: { id: 'a / b' }, query: { tag: ['one', 'two'] }, body: undefined });
  expect(validateApiInvocationDraft(operation, taskId, { ...draft, includeBody: true }).input?.body).toBe('');
  expect(validateApiInvocationDraft({ ...operation, method: 'GET' }, taskId, { ...draft, includeBody: true }).errors.body).toBe('catalog.invoke.bodyInvalid');
});

test('Swagger 转换保留序列化后的查询和文本正文，主机不进入后端输入', () => {
  const request = { spec: { servers: [{ url: 'http://api.service.invalid/api/crm' }] }, pathName: operation.path, method: 'post', parameters: { 'path.id': 'a / b' } };
  const built = { url: 'http://api.service.invalid/api/crm/items/a%20%2F%20b?tag=one&tag=two', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"active":true}' };
  const result = swaggerApiInvocation('crm', request, built, [operation], taskId);
  expect(result).toMatchObject({ operationKey: operation.key, expectedTaskId: taskId, pathParameters: { id: 'a / b' }, query: { tag: ['one', 'two'] }, body: built.body });
  expect(result).not.toHaveProperty('url');
  expect(() => swaggerApiInvocation('crm', request, built, [{ ...operation, granted: false }], taskId)).toThrow('catalog.invoke.operationUnavailable');
  expect(() => swaggerApiInvocation('crm', request, { ...built, body: new FormData() }, [operation], taskId)).toThrow('catalog.invoke.swaggerUnsupported');
  expect(() => swaggerApiInvocation('crm', request, { ...built, body: undefined, form: { title: 'cannot-drop' } }, [operation], taskId)).toThrow('catalog.invoke.swaggerUnsupported');
  expect(() => swaggerApiInvocation('crm', request, { ...built, url: 'http://api.service.invalid/api/crm/items/different' }, [operation], taskId)).toThrow('catalog.invoke.swaggerUnsupported');
  expect(() => swaggerApiInvocation('crm', request, built, [operation], undefined)).toThrow('catalog.invoke.noSession');
  expect(() => swaggerApiInvocation('crm', request, { ...built, url: built.url.replace('api.service.invalid', 'different.invalid') }, [operation], taskId)).toThrow('catalog.invoke.swaggerDestination');
});
