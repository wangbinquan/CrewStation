import { readFileSync } from 'node:fs';

// 发布副本与 console/public/brand 原稿逐字节验证一致；登录页可能运行在业务域且尚未登录，
// 内嵌同一 SVG，避免图片请求再次被网关重定向登录。只读构建随附资产。
const mark = readFileSync(new URL('./crewstation-mark.svg', import.meta.url), 'utf8');
export const brandMarkDataUrl = `data:image/svg+xml,${encodeURIComponent(mark)}`;
