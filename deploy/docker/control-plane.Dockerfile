# 控制面镜像：五个 cs-* 进程与两个 MCP 共用同一镜像，靠启动命令区分（同一套代码，不同入口）。
FROM oven/bun:1.3.13 AS base
# cs-controller 建仓时以子进程调用 git（clone／commit／push），基础镜像不带它
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json tsconfig.json ./
COPY apps ./apps
COPY modules ./modules
COPY packages ./packages
COPY runtimes ./runtimes
COPY tools ./tools
COPY templates ./templates
COPY integrations ./integrations
# 控制面不需要前端与任务容器的依赖：删掉它们的 package.json 让 bun 不安装
RUN rm -rf apps/console runtimes/task && bun install
ENV NODE_ENV=production
USER bun
ENTRYPOINT ["bun", "run"]
CMD ["apps/cs-api/src/main.ts"]
