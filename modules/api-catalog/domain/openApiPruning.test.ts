import { describe, expect, test } from 'bun:test';
import { operationsFromOpenApi } from './openApiOperations';
import { pruneOpenApi } from './openApiPruning';

const doc = {
  openapi: '3.0.3',
  info: { title: 'Issues', version: '1' },
  servers: [{ url: 'https://gitlab.example.com/api/v4' }],
  paths: {
    '/v1/issues': {
      parameters: [{ $ref: '#/components/parameters/Page' }],
      get: { summary: '列表', responses: { '200': { $ref: '#/components/responses/IssueList' } } },
      post: { summary: '创建', 'x-cs-resource-note': '按项目', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewIssue' } } } } },
      trace: { summary: '不进目录' },
    },
    '/v1/issues/{id}': { get: { summary: '详情', responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Issue' } } } } } } },
    'not-a-path': { get: {} },
  },
  components: {
    schemas: {
      Issue: { type: 'object', properties: { author: { $ref: '#/components/schemas/User' } } },
      User: { type: 'object' },
      NewIssue: { type: 'object' },
      Unused: { type: 'object' },
    },
    parameters: { Page: { name: 'page', in: 'query' } },
    responses: { IssueList: { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Issue' } } } } } },
    securitySchemes: { token: { type: 'apiKey', in: 'header', name: 'PRIVATE-TOKEN' } },
  },
};

describe('OpenAPI 操作发现与裁剪', () => {
  test('paths × 方法 → 操作；summary 与 x-cs-resource-note 进入目录，trace 与非法路径忽略', () => {
    expect(operationsFromOpenApi(doc)).toEqual([
      { method: 'GET', path: '/v1/issues', summary: '列表' },
      { method: 'POST', path: '/v1/issues', summary: '创建', resourceNote: '按项目' },
      { method: 'GET', path: '/v1/issues/{id}', summary: '详情' },
    ]);
    expect(() => operationsFromOpenApi({ openapi: '3.0.3' })).toThrow();
    expect(() => operationsFromOpenApi('nope')).toThrow();
  });

  test('只保留可调操作，沿 $ref 保留可达组件，securitySchemes 整体保留，servers 改写', () => {
    const pruned = pruneOpenApi(doc, { proxy: 'issues', allowedOperations: [{ id: '01a0bf5d-8f4b-7000-8000-000000000001', method: 'GET', path: '/v1/issues/{id}' }], serversUrl: 'http://api.svc.cs.internal/api/issues' });
    expect(Object.keys(pruned.paths as object)).toEqual(['/v1/issues/{id}']);
    const components = pruned.components as { schemas: object; parameters?: object; responses?: object; securitySchemes: object };
    expect(Object.keys(components.schemas).sort()).toEqual(['Issue', 'User']);
    expect(components.parameters).toBeUndefined();
    expect(components.responses).toBeUndefined();
    expect(Object.keys(components.securitySchemes)).toEqual(['token']);
    expect(pruned.servers).toEqual([{ url: 'http://api.svc.cs.internal/api/issues' }]);
    expect(pruned.info).toEqual(doc.info);
    expect(doc.paths['/v1/issues'].get).toBeDefined();
  });

  test('路径级 parameters 随保留的操作一起保留；无可调操作时 paths 为空', () => {
    const pruned = pruneOpenApi(doc, { proxy: 'issues', allowedOperations: [{ id: '01a0bf5d-8f4b-7000-8000-000000000001', method: 'GET', path: '/v1/issues' }], serversUrl: 'http://api.svc.cs.internal/api/issues' });
    const path = (pruned.paths as Record<string, Record<string, unknown>>)['/v1/issues']!;
    expect(Object.keys(path).sort()).toEqual(['get', 'parameters']);
    const components = pruned.components as { schemas: object; parameters: object; responses: object };
    expect(Object.keys(components.parameters)).toEqual(['Page']);
    expect(Object.keys(components.responses)).toEqual(['IssueList']);
    expect(Object.keys(components.schemas).sort()).toEqual(['Issue', 'User']);
    const empty = pruneOpenApi(doc, { proxy: 'issues', allowedOperations: [], serversUrl: 'http://api.svc.cs.internal/api/issues' });
    expect(empty.paths).toEqual({});
    expect((empty.components as { schemas?: object }).schemas).toBeUndefined();
  });

  test('OpenAPI 2.0：根级 definitions 按可达性裁剪，地址写入 schemes／host／basePath', () => {
    const swagger = {
      swagger: '2.0', info: { title: 'legacy', version: '1' }, host: 'legacy.example.com', basePath: '/api',
      paths: { '/things': { get: { responses: { '200': { schema: { $ref: '#/definitions/Thing' } } } }, delete: {} } },
      definitions: { Thing: { type: 'object' }, Other: { type: 'object' } },
      securityDefinitions: { basic: { type: 'basic' } },
    };
    const pruned = pruneOpenApi(swagger, { proxy: 'legacy', allowedOperations: [{ id: '01a0bf5d-8f4b-7000-8000-000000000001', method: 'GET', path: '/things' }], serversUrl: 'http://api.svc.cs.internal/api/legacy' });
    expect(Object.keys((pruned.paths as Record<string, object>)['/things']!)).toEqual(['get']);
    expect(Object.keys(pruned.definitions as object)).toEqual(['Thing']);
    expect(pruned.securityDefinitions).toEqual(swagger.securityDefinitions);
    expect(pruned).toMatchObject({ schemes: ['http'], host: 'api.svc.cs.internal', basePath: '/api/legacy' });
    expect(pruned.servers).toBeUndefined();
  });
});
