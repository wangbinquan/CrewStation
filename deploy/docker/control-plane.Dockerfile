# 控制面镜像：五个 cs-* 进程与两个 MCP 共用同一镜像，靠启动命令区分（同一套代码，不同入口）。
FROM oven/bun:1.3.13 AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY modules ./modules
COPY packages ./packages
COPY runtimes ./runtimes
COPY tools ./tools
# 控制面不需要前端与任务容器的依赖：删掉它们的 package.json 让 bun 不安装
RUN rm -rf apps/console runtimes/task && bun install --frozen-lockfile --production=false 2>/dev/null || bun install --production=false
ENV NODE_ENV=production
USER bun
ENTRYPOINT ["bun", "run"]
CMD ["apps/cs-api/src/main.ts"]
