import { expect, test } from 'bun:test';
import { consoleStyles, sourceAt } from './sourceScan';

test('形态图的语义色只在 tokens.css 声明，浅深两套各九组描边与填充', () => {
  // RFC-019 作者裁定语义色进 tokens：组件 CSS 只能引用 --cs-topo-*，不得自己声明，也不得写裸色值。
  const styles = consoleStyles(), tokens = sourceAt(styles, 'app/theme/tokens.css').code;
  expect(styles.filter((file) => /--cs-topo-[a-z]+-(stroke|fill)\s*:/.test(file.code)).map((file) => file.path)).toEqual(['app/theme/tokens.css']);
  expect(tokens.match(/--cs-topo-[a-z]+-stroke\s*:/g)).toHaveLength(18); expect(tokens.match(/--cs-topo-[a-z]+-fill\s*:/g)).toHaveLength(18);
  expect(/#[0-9a-f]{3,8}\b/i.test(sourceAt(styles, 'shared/ui/topology/Topology.module.css').code)).toBe(false);
});
