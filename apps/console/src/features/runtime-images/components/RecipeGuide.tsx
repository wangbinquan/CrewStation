import { useT } from '../../../shared/lib/useT';
import { CopyButton } from '../../../shared/ui/clipboard/CopyButton';
import styles from './RuntimeImages.module.css';

const taskExample = `ARG CS_BASE_IMAGE
FROM \${CS_BASE_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv nodejs npm && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /opt/tools/requirements.txt
RUN python3 -m venv /opt/tools/python && /opt/tools/python/bin/pip install --no-cache-dir -r /opt/tools/requirements.txt
COPY node/ /opt/tools/node/
RUN npm --prefix /opt/tools/node ci --omit=dev
COPY scripts/ /opt/tools/scripts/
COPY bin/ /opt/tools/bin/
RUN chmod -R a+rX /opt/tools && chmod 0755 /opt/tools/bin/*
# RUN sh /opt/tools/scripts/setup.sh
# Keep the inherited Runner entrypoint. Tools must be accessible to uid 10001.
`;
const serviceExample = `FROM oven/bun:1
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
USER bun
CMD ["bun", "run", "start"]
`;
export function RecipeGuide({ service, inline = false }: { readonly service: boolean; readonly inline?: boolean }) {
  const t = useT(), example = service ? serviceExample : taskExample;
  return <details><summary>{t('images.installGuide')}</summary><p>{t(service ? 'images.serviceDockerHint' : 'images.toolDockerHint')}</p>
    <ol><li>{t('images.guideFiles')}</li><li>{t(inline ? 'images.guideInline' : 'images.guideCommit')}</li><li>{t('images.guideValidate')}</li></ol>
    <CopyButton value={example} /><pre className={styles.code}>{example}</pre><p>{t('images.installPathHint')}</p>
  </details>;
}
