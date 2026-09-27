import sharp from 'sharp';
import { APP_ICON_MAX_BYTES } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { AppIconDecoder } from '../../ports/appIcons';

/** Decode untrusted bytes, not the browser-supplied MIME; never retain original metadata. */
export const sharpAppIconDecoder: AppIconDecoder = {
  normalize: async (bytes) => {
    if (!bytes.length || bytes.length > APP_ICON_MAX_BYTES) throw validation('图标大小必须在 1 字节至 2 MiB 之间');
    try {
      const image = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'warning' });
      const meta = await image.metadata();
      if (!['png', 'jpeg', 'webp'].includes(meta.format ?? '') || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) > 1) throw new Error('format or dimensions');
      const output = await image.rotate().resize(128, 128, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
      if (output.byteLength > 65536) throw new Error('normalized size');
      return { content: output.toString('base64'), mime: 'image/webp' };
    } catch { throw validation('图标必须是有效的静态 PNG、JPEG 或 WebP，宽高均不能超过 4096 像素'); }
  },
};
