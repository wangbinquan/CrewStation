# 任务容器镜像：tini 为 PID 1，TaskRunner 以 root 常驻，每个 Agent／终端／exec／预览子进程经 setpriv 降到 worker(10001)。
# 构建（仓库根为上下文）：docker build -f runtimes/task/Dockerfile -t cs-task-runtime:dev .
# 构建上下文由同目录的 Dockerfile.dockerignore 裁剪（BuildKit 按 <Dockerfile>.dockerignore 读取）。
FROM oven/bun:1.3.13

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini git util-linux bash curl ca-certificates procps \
  && rm -rf /var/lib/apt/lists/*

# worker：所有 Agent 进程的身份；家目录即工作目录挂载点 /work。
RUN groupadd --gid 10001 worker \
  && useradd --uid 10001 --gid 10001 --home-dir /work --create-home --shell /bin/bash worker

WORKDIR /app

# 只带运行时需要的工作区成员；根 package.json 的 workspaces 列表按实际复制的目录收窄，
# 因此这里不能用 --frozen-lockfile（锁文件描述的是整个仓库的工作区集合），而是对这个子集做普通安装：
# 依赖版本在各 package.json 里精确锁定（bunfig exact=true），结果仍是确定的。
COPY bunfig.toml ./
COPY packages/contracts packages/contracts
COPY packages/kernel packages/kernel
COPY packages/ws packages/ws
COPY packages/agent-drivers packages/agent-drivers
COPY runtimes/task runtimes/task
RUN printf '%s\n' \
  '{ "name": "crewstation-task-runtime-image", "private": true, "type": "module",' \
  '  "workspaces": ["packages/contracts", "packages/kernel", "packages/ws", "packages/agent-drivers", "runtimes/task"] }' \
  > package.json \
  && bun install --production \
  && rm -rf /root/.bun/install/cache

ENV CS_WORKDIR=/work \
    NODE_ENV=production
VOLUME ["/work"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "runtimes/task/src/main.ts"]
