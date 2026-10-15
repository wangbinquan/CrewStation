/** 域名建议只在用户尚未编辑标识时更新；中文名使用本次草稿稳定的随机后缀。 */
export function suggestProjectSlug(name: string, suffix: string): string {
  if (!name.trim()) return '';
  const latin = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const base = latin.length >= 3 && /^[a-z]/.test(latin) ? latin : latin ? `app-${latin}` : `app-${suffix}`;
  return base.slice(0, 40).replace(/-+$/g, '');
}
