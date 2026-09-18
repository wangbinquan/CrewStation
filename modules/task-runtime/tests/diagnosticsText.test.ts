import { describe, expect, test } from 'bun:test';
import { maskDiagnosticsText, outputTail } from '../domain/diagnosticsText';

const ESC = String.fromCharCode(27);

describe('测试失败原文的打码与尾部（移植 agent-workflow maskDiagnosticsText／outputTail）', () => {
  test('按凭据形状打码：URL userinfo、令牌类查询参数、令牌类命令行选项', () => {
    expect(maskDiagnosticsText('GET https://alice:pw@host/x')).toBe('GET https://***@host/x');
    expect(maskDiagnosticsText('/v1?token=t1&x=1&api_key=k2')).toBe('/v1?token=***&x=1&api_key=***');
    expect(maskDiagnosticsText('run --api-key k3 --token=t4')).toBe('run --api-key *** --token=***');
    expect(maskDiagnosticsText('no credentials here')).toBe('no credentials here');
  });

  test('已知凭据值整段替换，长值先替换，空值忽略', () => {
    expect(maskDiagnosticsText('key=abcdef and abc', ['abc', 'abcdef', ''])).toBe('key=*** and ***');
  });

  test('尾部压成一行、去掉 ANSI、超长只留末尾', () => {
    expect(outputTail(`a\n\n  b${ESC}[31mc${ESC}[0m`)).toBe('a bc');
    expect(outputTail(`${'x'.repeat(10)}END`, 5)).toBe('…xxEND');
  });
});
