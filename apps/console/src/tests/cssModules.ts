import { plugin } from 'bun';

/**
 * bun test 里 `import styles from './X.module.css'` 得到的是文件路径字符串，于是 `styles.link`
 * 命中 `String.prototype.link`（一个函数），React 会对着 className 报「Invalid value for prop」。
 * 这里把 CSS Module 换成「键即类名」的代理：渲染测试既不再报警，也能按类名断言。
 * 由 bunfig.toml 的 [test] preload 注册；对不碰 CSS 的测试是空操作。
 */
plugin({
  name: 'css-modules-stub',
  setup(build) {
    build.onLoad({ filter: /\.module\.css$/ }, () => ({
      contents: 'export default new Proxy({}, { get: (_target, key) => (typeof key === "string" ? key : undefined) });',
      loader: 'js',
    }));
  },
});
