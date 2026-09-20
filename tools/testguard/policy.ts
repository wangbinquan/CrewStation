// 新增代码防护闸门的取值全部集中在这里；改数字、放宽范围要走 ADR（ADR-0007）。

/** 本次推送改动的可执行行里，被用例执行到的比例下限（百分比）。 */
export const PATCH_LINE_COVERAGE_MIN = 80;

/** 算作「生产代码」的顶层目录；其余（docs、proposal、deploy 的脚本……）不在闸门范围内。 */
export const PRODUCTION_ROOTS: readonly string[] = ['apps', 'modules', 'packages', 'runtimes', 'tools', 'integrations', 'templates'];

/**
 * 进程入口：只做装配与启动，不进用例进程，由实机验收层兜底（docs/engineering/testing.md §8）。
 * 除这里的命名约定外，根 package.json `scripts` 里点名的脚本文件同样算入口。逻辑不许写在入口里。
 */
export const ENTRYPOINT_PATTERNS: readonly RegExp[] = [/(^|\/)main\.tsx?$/, /(^|\/)serve\.ts$/, /\.config\.(ts|js|mjs)$/];

/** 与根 package.json 的 `test:cover` 脚本写出的位置一致。 */
export const DEFAULT_JUNIT_PATH = 'coverage/junit.xml';
export const DEFAULT_LCOV_PATH = 'coverage/lcov.info';

/** 例外声明的规则名，格式见 docs/adr/README.md：`- exception: patch-coverage <路径或 glob> until <YYYY-MM-DD>`。 */
export const EXCEPTION_RULE = 'patch-coverage';
