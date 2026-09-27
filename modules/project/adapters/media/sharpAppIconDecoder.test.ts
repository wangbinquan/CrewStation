import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { sharpAppIconDecoder } from './sharpAppIconDecoder';

test('normalizes real PNG/JPEG/WebP to bounded static WebP, retaining aspect ratio', async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const original = await sharp({ create: { width: 240, height: 120, channels: 4, background: '#23734a' } }).toFormat(format).toBuffer();
    const icon = await sharpAppIconDecoder.normalize(original), bytes = Buffer.from(icon.content, 'base64');
    expect(icon.mime).toBe('image/webp'); expect(bytes.length).toBeLessThanOrEqual(65536);
    expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 128, height: 64 });
  }
});
test('rejects empty, oversized, corrupt, SVG, GIF and excessive dimensions', async () => {
  const large = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#fff' } }).png().toBuffer();
  const gif = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).gif().toBuffer();
  for (const input of [new Uint8Array(), new Uint8Array(2 * 1024 * 1024 + 1), Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'), gif, large]) await expect(sharpAppIconDecoder.normalize(input)).rejects.toMatchObject({ kind: 'validation' });
});
