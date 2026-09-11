# 工作台镜像：Vite 构建静态资源，运行时只用 Bun 内建服务器做 SPA 回退。
FROM oven/bun:1.3.13 AS build
WORKDIR /app
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY packages/api-client ./packages/api-client
COPY apps/console ./apps/console
RUN printf '{"name":"crewstation-console-build","private":true,"workspaces":["apps/console","packages/contracts","packages/api-client"]}' > package.json \
  && bun install && cd apps/console && bun run build

FROM oven/bun:1.3.13-slim
WORKDIR /srv
COPY --from=build /app/apps/console/dist ./dist
COPY apps/console/serve.ts ./serve.ts
USER bun
EXPOSE 8090
CMD ["bun", "run", "serve.ts"]
