import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CONSOLE_SRC = join(import.meta.dir, '..');
/** 本文件自己要写出这些词才能断言它们不存在，测试目录必须排除，否则永远红。 */
const SKIP_DIRS = new Set(['tests', 'node_modules']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return SKIP_DIRS.has(entry) ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

const files = sourceFiles(CONSOLE_SRC).map((path) => ({ path: path.slice(CONSOLE_SRC.length + 1), text: readFileSync(path, 'utf8') }));

/**
 * RFC-001 的验收项「工作台新建 Agent 只有档位下拉，全仓搜不到模型自由文本输入」。
 * 类型系统拦不住这件事：契约里去掉 `model` 之后，工作台照样可以加一个模型输入框再把值塞进
 * prompt 或别处。这里改成在源码层断言——回归时会直接指出是哪个文件又把模型搬回了租户面。
 */
describe('工作台不向租户暴露模型与驱动（RFC-001）', () => {
  test('租户面没有模型输入框：只有管理页可以出现 model 字段', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('features/admin/'))
      .filter((file) => /\bmodel(Placeholder)?\b\s*[:=]|setModel|'model'|"model"/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  test('租户面不出现驱动选择：AGENT_DRIVERS 这类清单只留在管理页', () => {
    const offenders = files
      .filter((file) => !file.path.startsWith('features/admin/'))
      .filter((file) => /AGENT_DRIVERS|COMPUTE_DRIVERS|'claude-code'|"claude-code"/.test(file.text))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  test('新建 Agent 表单读的是算力档位目录', () => {
    const form = files.find((file) => file.path.endsWith('agents/StartAgentForm.tsx'));
    expect(form).toBeDefined();
    expect(form?.text).toContain('listComputeProfiles()');
    expect(form?.text).toContain("t('devSession.agents.compute')");
  });
});
