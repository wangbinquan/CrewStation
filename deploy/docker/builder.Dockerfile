# 构建 Job 镜像：git 克隆标签 + buildctl 向 buildkitd 提交 Dockerfile 构建（release 模块的 BuildKit 适配器使用）。
FROM moby/buildkit:v0.33.0 AS buildkit
FROM alpine:3.22
RUN apk add --no-cache git ca-certificates
COPY --from=buildkit /usr/bin/buildctl /usr/bin/buildctl
RUN adduser -D -u 10001 builder
USER builder
WORKDIR /work
