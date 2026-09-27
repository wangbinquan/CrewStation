# 平台按任务底座或所选 Agent 档位修订注入固定摘要，用户无需填写 CS_BASE_IMAGE。
ARG CS_BASE_IMAGE
FROM ${CS_BASE_IMAGE} AS native-build
USER root
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY native/tool.c /tmp/tool.c
RUN cc -O2 -o /tmp/cs-example-tool /tmp/tool.c

FROM ${CS_BASE_IMAGE}
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3-venv nodejs npm ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /opt/business-tools/requirements.txt
RUN python3 -m venv /opt/business-tools/python \
    && /opt/business-tools/python/bin/pip install --no-cache-dir --no-deps -r /opt/business-tools/requirements.txt
COPY node/ /opt/business-tools/node/
RUN npm --prefix /opt/business-tools/node ci --omit=dev --ignore-scripts \
    && npm cache clean --force
COPY --from=native-build /tmp/cs-example-tool /usr/local/bin/cs-example-tool
COPY scripts/hello.sh /usr/local/bin/cs-example-script
COPY scripts/install-binary.sh /opt/business-tools/install-binary.sh
RUN chmod 0755 /usr/local/bin/cs-example-tool /usr/local/bin/cs-example-script /opt/business-tools/install-binary.sh \
    && setpriv --reuid=10001 --regid=10001 --init-groups /usr/local/bin/cs-example-tool \
    && setpriv --reuid=10001 --regid=10001 --init-groups /usr/local/bin/cs-example-script \
    && setpriv --reuid=10001 --regid=10001 --init-groups /opt/business-tools/python/bin/python -c 'import yaml; print(yaml.safe_load("status: ready")["status"])' \
    && setpriv --reuid=10001 --regid=10001 --init-groups node /opt/business-tools/node/check.cjs \
    && setpriv --reuid=10001 --regid=10001 --init-groups node /opt/business-tools/node/check.mjs
# 保留继承的 Runner 启动入口；不把工具安装到 /root 或将工作卷中的 node_modules 当全局依赖。
