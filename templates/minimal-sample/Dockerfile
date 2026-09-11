# 与开发会话／任务容器同一 Bun 版本；精确版本在 Plan T0.2 锁定前以此为准。
FROM oven/bun:1.3.13
WORKDIR /app
# 先装依赖再拷源码：改源码不触发重新安装。
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/main.ts"]
