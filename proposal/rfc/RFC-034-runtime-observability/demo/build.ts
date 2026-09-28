import { resolve } from 'node:path';
const dir = import.meta.dir;
const consoleRoot = resolve(dir, '../../../../apps/console');
const result = await Bun.build({
  entrypoints: [resolve(dir, 'main.tsx')], outdir: resolve(dir, 'dist'), target: 'browser', minify: true, external: ['/brand/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'installed-console-react', setup(build) {
    build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({ path: Bun.resolveSync(args.path, consoleRoot) }));
  } }],
});
if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
console.log(result.outputs.map((output) => `${output.path} ${output.size} bytes`).join('\n'));
