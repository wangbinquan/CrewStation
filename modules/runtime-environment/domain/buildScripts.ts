import { validation } from '@crewstation/kernel';
import type { ImageRevision } from './records';

export const shellArg = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Git token 只挂入 checkout init container；导出的上下文没有 .git 与本地未提交文件。 */
export function imageCheckoutScript(repositoryUrl: string, revision: ImageRevision): string {
  if (revision.source.kind !== 'source' || !revision.commitSha) throw validation('构建缺少固定源码');
  const url = new URL(repositoryUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw validation('源码地址必须来自已授权绑定且不能内嵌凭据');
  const { context, dockerfile } = revision.source;
  return `set -eu
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
cat > /tmp/cs-askpass <<'CS_ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'crewstation-build' ;;
  *Password*) cat /git-auth/token ;;
  *) exit 1 ;;
esac
CS_ASKPASS
chmod 700 /tmp/cs-askpass
export GIT_ASKPASS=/tmp/cs-askpass
trap 'rm -f /tmp/cs-askpass' EXIT
git init -q /tmp/repository
git -C /tmp/repository -c credential.helper= -c http.followRedirects=false fetch --depth=1 ${shellArg(repositoryUrl)} ${shellArg(revision.commitSha)}
test "$(git -C /tmp/repository rev-parse FETCH_HEAD)" = ${shellArg(revision.commitSha)}
mkdir -p /workspace/context
git -C /tmp/repository archive --format=tar FETCH_HEAD > /tmp/source.tar
tar -xf /tmp/source.tar -C /workspace/context
context=$(realpath ${shellArg(`/workspace/context/${context}`)})
case "$context/" in /workspace/context/*) ;; *) echo 'context escapes source' >&2; exit 1 ;; esac
dockerfile=$(realpath ${shellArg(`/workspace/context/${context}/${dockerfile}`)})
case "$dockerfile" in "$context"/*) ;; *) echo 'Dockerfile escapes context' >&2; exit 1 ;; esac
test -f "$dockerfile"
find "$context" -type l -print0 > /tmp/cs-source-links
xargs -0 -r -n1 sh -ec 'target=$(realpath "$2"); case "$target/" in "$1"/*) ;; *) echo "source link escapes context" >&2; exit 1 ;; esac' sh "$context" < /tmp/cs-source-links
test -z "$(find "$context" -name .gitmodules -print -quit)"
rm -rf /tmp/repository /tmp/source.tar
`;
}

/** 用户参数始终是一个 shell 参数；包 Secret 只经 BuildKit session mount，绝不写入 ARG/ENV。 */
export function imageClientScript(revision: ImageRevision, destination: string, insecure: boolean): string {
  if (revision.source.kind !== 'source') throw validation('已有镜像不应创建构建客户端');
  const source = revision.source, context = `/workspace/context/${source.context}`;
  const args = ['buildctl', '--addr', 'unix:///run/cs-build/buildkitd.sock', 'build', '--frontend', 'dockerfile.v0', '--local', `context=${context}`, '--local', `dockerfile=${context}`, '--opt', `filename=${source.dockerfile}`, '--opt', `platform=${source.architecture}`];
  if (source.target) args.push('--opt', `target=${source.target}`);
  if (revision.baseImage) args.push('--opt', `build-arg:CS_BASE_IMAGE=${revision.baseImage}`);
  for (const [key, value] of Object.entries(source.buildArgs)) args.push('--opt', `build-arg:${key}=${value}`);
  for (const secret of source.secrets) args.push('--secret', `id=${secret.id},src=/build-secrets/${secret.id}`);
  args.push('--output', `type=image,name=${destination},push=true${insecure ? ',registry.insecure=true' : ''}`, '--metadata-file', '/tmp/build-metadata.json');
  return `set -eu
trap 'touch /run/cs-build/client.done' EXIT
until buildctl --addr unix:///run/cs-build/buildkitd.sock debug workers >/dev/null 2>&1; do sleep 1; done
${args.map(shellArg).join(' ')}
digest=$(sed -n 's/^[[:space:]]*"containerimage.digest":[[:space:]]*"\\(sha256:[0-9a-f]*\\)".*/\\1/p' /tmp/build-metadata.json)
printf '%s\\n' "$digest" | grep -Eq '^sha256:[0-9a-f]{64}$'
printf '{"containerimage.digest":"%s"}' "$digest" > /tmp/build-result.json
`;
}

/** 单次构建 daemon 只开本地 Unix socket；客户端结束后停止 daemon，整个 Job 才能结束。 */
export function imageDaemonScript(registry: string, insecure: boolean): string {
  if (!/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(registry)) throw validation('平台注册表主机不合法');
  const config = `[registry."${registry}"]\n  http = ${insecure}\n  insecure = false\n`;
  return `set -eu
printf '%s' ${shellArg(config)} > /tmp/cs-buildkitd.toml
rootlesskit buildkitd --addr unix:///run/cs-build/buildkitd.sock --root /home/user/.local/share/buildkit --oci-worker-no-process-sandbox --config /tmp/cs-buildkitd.toml &
daemon=$!
trap 'kill -TERM "$daemon" 2>/dev/null || true; wait "$daemon" 2>/dev/null || true' EXIT TERM INT
while [ ! -e /run/cs-build/client.done ]; do
  kill -0 "$daemon" 2>/dev/null || exit 1
  sleep 1
done
`;
}
